import * as path from 'path';
import { it } from '@jest/globals';
import { spawn } from 'child_process';
import type {
    CancellationToken,
    ExtensionContext,
    NotebookCell,
    NotebookCellExecution,
    NotebookController,
    NotebookDocument
} from 'vscode';
import { JavaScriptKernel } from '../../extension/kernel/jsKernel';
import { Compiler } from '../../extension/kernel/compiler';
import { CellOutput } from '../../extension/kernel/cellOutput';
import getPort from 'get-port';
import { ServerLogger } from '../../extension/serverLogger';

jest.mock('get-port', () => jest.fn());
jest.mock('child_process', () => ({
    ...jest.requireActual<typeof import('child_process')>('child_process'),
    spawn: jest.fn()
}));
jest.mock(
    'vscode',
    () => ({
        workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
    }),
    { virtual: true }
);
jest.mock('../../extension/kernel/compiler', () => ({
    Compiler: { getOrCreateCodeObject: jest.fn() }
}));
jest.mock('../../extension/kernel/cellOutput', () => ({
    CellOutput: { getOrCreate: jest.fn() }
}));
jest.mock('../../extension/serverLogger', () => ({
    ServerLogger: { appendLine: jest.fn(), append: jest.fn() }
}));
jest.mock('../../extension/tfjsvis', () => ({ TensorflowVisClient: {} }));
jest.mock('../../extension/kernel/debugger/debugFactory', () => ({
    DebuggerFactory: { isAttached: () => false }
}));

describe('Node kernel console execution', () => {
    let kernel: JavaScriptKernel;
    let appendStreamMock: jest.Mock;
    let endMock: jest.Mock;
    let getCodeMock: jest.Mock;
    let getOutputMock: jest.Mock;
    let startMock: jest.Mock;
    let spawnMock: jest.Mock;
    let getPortMock: jest.Mock;
    let appendResultMock: jest.Mock;
    let appendErrorMock: jest.Mock;
    let logMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        appendStreamMock = jest.fn();
        endMock = jest.fn();
        startMock = jest.fn();
        logMock = jest.mocked(ServerLogger.appendLine);
        appendResultMock = jest.fn();
        appendErrorMock = jest.fn();
        getPortMock = jest.mocked(getPort);
        getPortMock.mockImplementation(jest.requireActual<typeof import('get-port')>('get-port'));
        spawnMock = jest.mocked(spawn);
        const actualSpawn = jest.requireActual<typeof import('child_process')>('child_process').spawn;
        spawnMock.mockImplementation((...args: Parameters<typeof spawn>) => {
            const child = actualSpawn(...args);
            setImmediate(() => {
                child.stdout?.pause();
                setTimeout(() => child.stdout?.resume(), 500);
            });
            return child;
        });
        getCodeMock = jest.mocked(Compiler.getOrCreateCodeObject);
        getOutputMock = jest.mocked(CellOutput.getOrCreate);
        getOutputMock.mockReturnValue({
            appendStreamOutput: appendStreamMock,
            appendOutput: appendResultMock,
            appendError: appendErrorMock,
            end: endMock
        });
        getCodeMock.mockReturnValue({
            code: 'console.log(42);',
            sourceFilename: '/tmp/notebook-console-test.js',
            sourceTsFilename: '/tmp/notebook-console-test.ts',
            sourceMapFilename: '/tmp/notebook-console-test.js.map',
            friendlyName: 'console test',
            textDocumentVersion: 1
        });
        JavaScriptKernel.register({
            extensionUri: { fsPath: path.resolve(__dirname, '../../..') }
        } as ExtensionContext);
    });

    afterEach(() => {
        kernel.dispose();
    });

    function createTask(): NotebookCellExecution {
        const notebook = { isUntitled: false, uri: { fsPath: '/tmp/notebook-console-test.nnb' } } as NotebookDocument;
        const cell = {
            notebook,
            index: 0,
            document: { getText: () => 'console.log(42);' }
        } as NotebookCell;
        return {
            cell,
            start: startMock,
            clearOutput: jest.fn().mockResolvedValue(undefined),
            token: { isCancellationRequested: false, onCancellationRequested: jest.fn() },
            executionOrder: undefined,
            end: endMock,
            replaceOutput: jest.fn(),
            appendOutput: jest.fn(),
            replaceOutputItems: jest.fn(),
            appendOutputItems: jest.fn()
        };
    }

    it('initializes the real server, runs a cell, and receives console output', async () => {
        const task = createTask();
        kernel = JavaScriptKernel.getOrCreate(task.cell.notebook, {} as NotebookController);

        await kernel.runCell(task, {} as CancellationToken);

        expect(startMock).toHaveBeenCalled();
        expect(appendStreamMock).toHaveBeenCalledWith(expect.stringContaining('42'), 'stdout');
        expect(endMock).toHaveBeenCalledWith(true, expect.any(Number));
        expect(appendStreamMock.mock.invocationCallOrder[0]).toBeLessThan(endMock.mock.invocationCallOrder[0]);
        const logMessages = logMock.mock.calls.map(([message]) => String(message)).join('\n');
        expect(logMessages).toContain('stdout completion marker received');
        expect(logMessages).toContain('execution response');
        expect(logMessages).toContain('cell completed');
    }, 10000);

    it('completes the reported function cell and returns its greeting', async () => {
        const task = createTask();
        getCodeMock.mockReturnValue({
            code: 'function greet(name) { return `Greetings, ${name}!`; } greet("TDP 2025");',
            sourceFilename: '/tmp/notebook-function-test.js',
            sourceTsFilename: '/tmp/notebook-function-test.ts',
            sourceMapFilename: '/tmp/notebook-function-test.js.map',
            friendlyName: 'function test',
            textDocumentVersion: 1
        });
        kernel = JavaScriptKernel.getOrCreate(task.cell.notebook, {} as NotebookController);

        await kernel.runCell(task, {} as CancellationToken);

        expect(appendResultMock).toHaveBeenCalledTimes(1);
        expect(appendResultMock.mock.calls[0][0].type).toBe('text');
        expect(appendResultMock.mock.calls[0][0].value).toContain("'Greetings, TDP 2025!'");
        expect(endMock).toHaveBeenCalledWith(true, expect.any(Number));
        expect(appendResultMock.mock.invocationCallOrder[0]).toBeLessThan(endMock.mock.invocationCallOrder[0]);
    }, 10000);

    it('reports startup failures instead of leaving the cell pending', async () => {
        const task = createTask();
        const error = new Error('Port allocation failed');
        getPortMock.mockRejectedValueOnce(error);
        kernel = JavaScriptKernel.getOrCreate(task.cell.notebook, {} as NotebookController);

        expect(await kernel.runCell(task, {} as CancellationToken)).toBe('error');
        expect(appendErrorMock).toHaveBeenCalledWith(error);
        expect(endMock).toHaveBeenCalledWith(false, expect.any(Number));
    }, 10000);

    it('reports a missing Node executable instead of waiting for initialization', async () => {
        const task = createTask();
        const actualSpawn = jest.requireActual<typeof import('child_process')>('child_process').spawn;
        spawnMock.mockImplementation(() => actualSpawn('/nonexistent/notebook-test-node'));
        kernel = JavaScriptKernel.getOrCreate(task.cell.notebook, {} as NotebookController);

        expect(await kernel.runCell(task, {} as CancellationToken)).toBe('error');
        expect(appendErrorMock).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('ENOENT') })
        );
        expect(endMock).toHaveBeenCalledWith(false, expect.any(Number));
    }, 10000);
});
