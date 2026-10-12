import type { NotebookCell, NotebookCellExecution, NotebookController, NotebookDocument } from 'vscode';
import { CellOutput } from '../../extension/kernel/cellOutput';
import { notebooks, NotebookCellOutput, NotebookCellOutputItem } from 'vscode';

jest.mock(
    'vscode',
    () => ({
        notebooks: { createRendererMessaging: jest.fn() },
        NotebookCellOutput: class {
            constructor(public items: unknown[], public metadata?: Record<string, unknown>) {}
        },
        NotebookCellOutputItem: {
            text: (value: string) => ({ data: Buffer.from(value), mime: 'text/plain' }),
            stdout: (value: string) => ({ data: Buffer.from(value), mime: 'application/vnd.code.notebook.stdout' })
        }
    }),
    { virtual: true }
);
jest.mock('../../extension/kernel/compiler', () => ({
    Compiler: { fixCellPathsInStackTrace: (_notebook: NotebookDocument, value: string) => value }
}));
jest.mock('../../extension/kernel/problems', () => ({ CellDiagnosticsProvider: {} }));

describe('Notebook output delivery', () => {
    let createMessagingMock: jest.Mock;
    let appendMock: jest.Mock;
    let endMock: jest.Mock;
    let task: NotebookCellExecution;
    let output: CellOutput;
    let finishAppend: () => void;

    beforeEach(() => {
        jest.clearAllMocks();
        createMessagingMock = jest.mocked(notebooks.createRendererMessaging);
        const rendererIds: string[] = require('../../../package.json').contributes.notebookRenderer.map(
            (renderer: { id: string }) => renderer.id
        );
        createMessagingMock.mockImplementation((id: string) => {
            if (!rendererIds.includes(id)) {
                throw new Error(`Unknown notebook renderer: ${id}`);
            }
            return { onDidReceiveMessage: jest.fn() };
        });
        const pendingAppend = new Promise<void>((resolve) => {
            finishAppend = resolve;
        });
        appendMock = jest.fn().mockReturnValue(pendingAppend);
        endMock = jest.fn();
        const cell = { notebook: {}, outputs: [] } as unknown as NotebookCell;
        task = {
            cell,
            token: { isCancellationRequested: false, onCancellationRequested: jest.fn() },
            executionOrder: undefined,
            start: jest.fn(),
            end: endMock,
            clearOutput: jest.fn(),
            replaceOutput: jest.fn(),
            appendOutput: appendMock,
            replaceOutputItems: jest.fn(),
            appendOutputItems: jest.fn()
        };
        output = CellOutput.getOrCreate(task, {} as NotebookController, 'output-test');
    });

    it('uses a renderer registered in the extension manifest', () => {
        expect(createMessagingMock).toHaveBeenCalledWith('node-notebook-extended-tensorflow-vis-renderer');
    });

    it('awaits the actual VS Code output append before completing an expression cell', async () => {
        output.appendOutput({ type: 'text', value: 'Greetings, TDP 2025!', requestId: 'output-test' });
        const ending = output.end(true);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(appendMock).toHaveBeenCalledWith(
            new NotebookCellOutput([NotebookCellOutputItem.text('Greetings, TDP 2025!')])
        );
        expect(endMock).not.toHaveBeenCalled();
        finishAppend();
        await ending;
        expect(endMock).toHaveBeenCalledWith(true, undefined);
    });

    it('delivers console output before completing the cell', async () => {
        output.appendStreamOutput('System started\n', 'stdout');
        const ending = output.end(true);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(appendMock).toHaveBeenCalled();
        expect(endMock).not.toHaveBeenCalled();
        finishAppend();
        await ending;
        expect(endMock).toHaveBeenCalledWith(true, undefined);
    });
});
