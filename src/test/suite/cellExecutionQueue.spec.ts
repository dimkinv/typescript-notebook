import type { NotebookCell, NotebookCellExecution, NotebookController, NotebookDocument } from 'vscode';
import { CellExecutionQueue } from '../../extension/kernel/cellExecutionQueue';
import { CellDiagnosticsProvider } from '../../extension/kernel/problems';
import { JavaScriptKernel } from '../../extension/kernel/jsKernel';

jest.mock(
    'vscode',
    () => ({
        NotebookCellKind: { Markup: 1, Code: 2 },
        CancellationTokenSource: class {
            token = { isCancellationRequested: false };
            cancel() {
                this.token.isCancellationRequested = true;
            }
        }
    }),
    { virtual: true }
);
jest.mock('../../extension/kernel/problems', () => ({
    CellDiagnosticsProvider: { clearRuntimeErrors: jest.fn(), checkTypes: jest.fn() }
}));
jest.mock('../../extension/kernel/jsKernel', () => ({
    JavaScriptKernel: { getOrCreate: jest.fn(), get: jest.fn() }
}));
jest.mock('../../extension/kernel/shellKernel', () => ({ ShellKernel: {} }));
jest.mock('../../extension/kernel/browserExecution', () => ({}));
jest.mock('../../extension/kernel/cellOutput', () => ({ CellOutput: { resetCell: jest.fn() } }));

describe('Execution with TypeScript errors', () => {
    let queue: CellExecutionQueue;
    let checkTypesMock: jest.Mock;
    let getKernelMock: jest.Mock;
    let runCellMock: jest.Mock;
    let createExecutionMock: jest.Mock;
    let cell: NotebookCell;
    let executionStarted: Promise<void>;

    beforeEach(() => {
        jest.clearAllMocks();
        checkTypesMock = jest.mocked(CellDiagnosticsProvider.checkTypes);
        checkTypesMock.mockReturnValue(false);
        getKernelMock = jest.mocked(JavaScriptKernel.getOrCreate);
        runCellMock = jest.fn();
        executionStarted = new Promise<void>((resolve) => {
            runCellMock.mockImplementation(async () => {
                resolve();
                return 'success';
            });
        });
        getKernelMock.mockReturnValue({ runCell: runCellMock });
        const notebook = {} as NotebookDocument;
        cell = {
            kind: 2,
            notebook,
            document: { languageId: 'typescript', getText: () => 'const value: number = "test"; console.log(value);' }
        } as NotebookCell;
        const task: NotebookCellExecution = {
            cell,
            token: { isCancellationRequested: false, onCancellationRequested: jest.fn() },
            executionOrder: undefined,
            start: jest.fn(),
            end: jest.fn(),
            clearOutput: jest.fn(),
            replaceOutput: jest.fn(),
            appendOutput: jest.fn(),
            replaceOutputItems: jest.fn(),
            appendOutputItems: jest.fn()
        };
        createExecutionMock = jest.fn().mockReturnValue(task);
        const controller = { createNotebookCellExecution: createExecutionMock } as unknown as NotebookController;
        queue = CellExecutionQueue.create(notebook, controller);
    });

    afterEach(() => queue.dispose());

    it('runs the cell even when notebook type checking reports errors', async () => {
        await queue.enqueueAndRun(cell);
        await executionStarted;

        expect(checkTypesMock).toHaveBeenCalledWith(cell.notebook);
        expect(createExecutionMock).toHaveBeenCalledWith(cell);
        expect(runCellMock).toHaveBeenCalledWith(expect.objectContaining({ cell }), expect.anything());
    });
});
