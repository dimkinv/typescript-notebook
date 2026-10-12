import {
    CancellationToken,
    ExtensionContext,
    NotebookCell,
    NotebookCellExecution,
    NotebookController,
    NotebookDocument,
    Uri,
    window,
    workspace
} from 'vscode';
import { IDisposable } from '../types';
import type WebSocketClient from 'ws';
const getPort: typeof import('get-port') = require('get-port');
const WebSocket: typeof import('ws') = require('ws');
import { CellExecutionState } from './types';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { createDeferred, Deferred, generateId, noop } from '../coreUtils';
import { ServerLogger } from '../serverLogger';
import { CellOutput as CellOutput } from './cellOutput';
import { getNotebookCwd } from '../utils';
import { TensorflowVisClient } from '../tfjsvis';
import { Compiler } from './compiler';
import { CodeObject, RequestType, ResponseType } from '../server/types';
import { getConfiguration, writeConfigurationToTempFile } from '../configuration';
import { quote } from 'shell-quote';
import { getNextExecutionOrder } from './executionOrder';
import { DebuggerFactory } from './debugger/debugFactory';
import { EOL } from 'os';
import { createConsoleOutputCompletedMarker } from '../const';

const kernels = new WeakMap<NotebookDocument, JavaScriptKernel>();
const usedPorts = new Set<number>();
let getPortsPromise: Promise<unknown> = Promise.resolve();

export class JavaScriptKernel implements IDisposable {
    private static extensionDir: Uri;
    private starting?: Promise<void>;
    private server?: import('ws').Server;
    private webSocket = createDeferred<WebSocketClient>();
    private serverProcess?: ChildProcess;
    private startHandlingStreamOutput?: boolean;
    private disposed?: boolean;
    private initialized = createDeferred<void>();
    private readonly _debugPort = createDeferred<number>();
    public get debugPort(): Promise<number> {
        return this._debugPort.promise;
    }
    private readonly mapOfCodeObjectsToCellIndex = new Map<string, number>();
    private tasks = new Map<
        number | string,
        {
            task: NotebookCellExecution;
            requestId: string;
            result: Deferred<CellExecutionState>;
            stdOutput: CellOutput;
        }
    >();
    private currentTask?: {
        task: NotebookCellExecution;
        requestId: string;
        result: Deferred<CellExecutionState>;
        stdOutput: CellOutput;
    };
    private lastStdOutput?: CellOutput;
    private waitingForLastOutputMessage?: { expectedString: string; deferred: Deferred<void> };
    private readonly cwd?: string;
    constructor(private readonly notebook: NotebookDocument, private readonly controller: NotebookController) {
        this.cwd = getNotebookCwd(notebook);
        this.trace('created; cwd=%s', this.cwd);
    }
    private trace(message: string, ...details: unknown[]) {
        ServerLogger.appendLine(`[Kernel ${this.notebook.uri.fsPath}] ${message}`, ...details);
    }
    public static get(notebook: NotebookDocument) {
        return kernels.get(notebook);
    }
    public static register(context: ExtensionContext) {
        JavaScriptKernel.extensionDir = context.extensionUri;
    }
    public static broadcast(message: RequestType) {
        workspace.notebookDocuments.forEach((notebook) => {
            const kernel = JavaScriptKernel.get(notebook);
            if (kernel) {
                void kernel.sendMessage(message);
            }
        });
    }
    public static getOrCreate(notebook: NotebookDocument, controller: NotebookController) {
        let kernel = kernels.get(notebook);
        if (kernel) {
            return kernel;
        }
        kernel = new JavaScriptKernel(notebook, controller);
        kernels.set(notebook, kernel);
        void kernel.start().catch((error: unknown) => ServerLogger.appendLine('Failed to start Node.js kernel:', error));
        return kernel;
    }
    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.trace('disposing; pid=%s pendingTasks=%s', this.serverProcess?.pid, this.tasks.size);
        Array.from(this.tasks.values()).forEach((item) => {
            try {
                item.stdOutput.end(undefined);
            } catch (ex) {
                //
            }
        });
        this.tasks.clear();
        kernels.delete(this.notebook);
        this.serverProcess?.kill();
        this.serverProcess = undefined;
        this.webSocket.promise.then((socket) => socket.terminate(), noop);
        this.server?.close();
        this.waitingForLastOutputMessage?.deferred.resolve();
    }
    /**
     * We cannot stop execution of JS, hence ignore the cancellation token.
     */
    public async runCell(
        task: NotebookCellExecution,
        // We cannot stop execution of JS, hence ignore the cancellation token.
        _token: CancellationToken
    ): Promise<CellExecutionState> {
        this.trace('cell %s requested; language=%s initialized=%s', task.cell.index + 1, task.cell.document.languageId, this.initialized.completed);
        try {
            await this.start();
            this.trace('cell %s waiting for initialization', task.cell.index + 1);
            await this.initialized.promise;
        } catch (error: unknown) {
            this.trace('cell %s startup failed: %s', task.cell.index + 1, error);
            task.start(Date.now());
            await task.clearOutput();
            const output = CellOutput.getOrCreate(task, this.controller, generateId());
            output.appendError(error instanceof Error ? error : new Error(String(error)));
            await output.end(false, Date.now());
            return CellExecutionState.error;
        }
        task.start(Date.now());
        // TODO: fix waiting on https://github.com/microsoft/vscode/issues/131123
        await task.clearOutput();
        if (JavaScriptKernel.isEmptyCell(task.cell)) {
            task.end(undefined);
            return CellExecutionState.notExecutedEmptyCell;
        }
        const requestId = generateId();
        this.trace('cell %s started; request=%s', task.cell.index + 1, requestId);
        this.waitingForLastOutputMessage = {
            expectedString: createConsoleOutputCompletedMarker(requestId),
            deferred: createDeferred<void>()
        };
        const result = createDeferred<CellExecutionState>();
        const stdOutput = CellOutput.getOrCreate(task, this.controller, requestId);
        this.currentTask = { task, requestId, result, stdOutput };
        this.lastStdOutput = stdOutput;
        this.tasks.set(requestId, { task, requestId, result, stdOutput });
        task.executionOrder = getNextExecutionOrder(task.cell.notebook);
        let code: CodeObject;
        try {
            this.trace('request=%s compiling cell %s', requestId, task.cell.index + 1);
            code = Compiler.getOrCreateCodeObject(task.cell);
        } catch (ex: unknown) {
            this.trace('request=%s compilation failed: %s', requestId, ex);
            console.error(`Failed to generate code object`, ex);
            const error = new Error(`Failed to generate code object, ${(ex as Partial<Error> | undefined)?.message}`);
            error.stack = ''; // Don't show stack trace pointing to our internal code (its not useful & its ugly)
            stdOutput.appendError(error);
            stdOutput.end(false, Date.now());
            return CellExecutionState.error;
        }
        this.mapOfCodeObjectsToCellIndex.set(code.sourceFilename, task.cell.index);
        this.trace('request=%s compiled; file=%s characters=%s', requestId, code.sourceFilename, code.code.length);
        ServerLogger.appendLine(`Execute:`);
        ServerLogger.appendLine(code.code);
        await this.sendMessage({ type: 'cellExec', code, requestId });
        return result.promise;
    }
    private static isEmptyCell(cell: NotebookCell) {
        return cell.document.getText().trim().length === 0;
    }
    private async start() {
        if (!this.starting) {
            this.starting = this.startInternal();
        }
        return this.starting;
    }
    private async startInternal() {
        this.trace('startup: allocating ports and writing configuration');
        const [port, debugPort, configFile] = await Promise.all([
            this.getPort(),
            this.getPort(),
            writeConfigurationToTempFile()
        ]);
        this.trace('startup: websocketPort=%s debugPort=%s config=%s', port, debugPort, configFile);
        this.server = new WebSocket.Server({ port });
        this.server.on('error', (error: Error) => {
            ServerLogger.appendLine('Kernel WebSocket server failed:', error);
            if (!this.initialized.completed) {
                this.initialized.reject(error);
            }
        });
        this.server.on('connection', (ws) => {
            this.trace('WebSocket connected');
            ws.on('close', (code, reason) => this.trace('WebSocket closed; code=%s reason=%s', code, reason.toString()));
            ws.on('error', (error) => this.trace('WebSocket error: %s', error));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ws.on('message', (message: any) => {
                if (typeof message === 'string' && message.startsWith('{') && message.endsWith('}')) {
                    try {
                        const msg: ResponseType = JSON.parse(message);
                        this.onMessage(msg);
                        if (msg.type === 'initialized') {
                            this.startHandlingStreamOutput = true;
                            this._debugPort.resolve(debugPort);
                            this.initialized.resolve();
                            this.trace('kernel initialized; pid=%s', this.serverProcess?.pid);
                        }
                    } catch (ex) {
                        this.trace('Failed to handle message; bytes=%s error=%s', message.length, ex);
                    }
                } else {
                    this.trace('Unexpected WebSocket payload; type=%s buffer=%s', typeof message, Buffer.isBuffer(message));
                }
            });

            void this.sendMessage({ type: 'initialize', requestId: '' });
            this.webSocket.resolve(ws);
        });
        this.server.on('listening', () => {
            if (this.disposed) {
                return;
            }
            const serverFile = path.join(
                JavaScriptKernel.extensionDir.fsPath,
                'out',
                'extension',
                'server',
                'index.js'
            );
            ServerLogger.appendLine(`Starting node ${serverFile} & listening on ${debugPort} & websock on ${port}`);

            this.serverProcess = spawn(
                'node',
                [`--inspect=${debugPort}`, serverFile, `--port=${port}`, `--config=${quote([configFile])}`],
                {
                    // this.serverProcess = spawn('node', [serverFile, `--port=${port}`], {
                    cwd: this.cwd
                }
            );
            this.serverProcess.on('spawn', () => this.trace('process spawned; pid=%s cwd=%s', this.serverProcess?.pid, this.cwd));
            this.serverProcess.on('close', (code: number | null) => {
                ServerLogger.appendLine(`Server Exited, code = ${code}`);
                if (!this.disposed && !this.initialized.completed) {
                    this.initialized.reject(new Error(`Node.js kernel exited before initialization (code ${code})`));
                }
            });
            this.serverProcess.on('error', (error) => {
                ServerLogger.appendLine('Server Exited, error:', error);
                if (!this.initialized.completed) {
                    this.initialized.reject(error);
                }
            });
            this.serverProcess.stderr?.on('data', (data: Buffer | string) => {
                this.trace('stderr chunk; bytes=%s forwarding=%s request=%s', data.length, !!this.startHandlingStreamOutput, this.currentTask?.requestId);
                if (this.startHandlingStreamOutput) {
                    const output = this.getCellOutput();
                    if (output) {
                        data = data.toString();
                        if (DebuggerFactory.isAttached(this.notebook)) {
                            data = DebuggerFactory.stripDebuggerMessages(data);
                        }
                        if (data.length > 0) {
                            output.appendStreamOutput(data, 'stderr');
                        }
                    }
                } else {
                    ServerLogger.append(data.toString());
                }
            });
            this.serverProcess.stdout?.on('data', (data: Buffer | string) => {
                this.trace('stdout chunk; bytes=%s forwarding=%s request=%s', data.length, !!this.startHandlingStreamOutput, this.currentTask?.requestId);
                data = data.toString();
                if (this.startHandlingStreamOutput) {
                    const output = this.getCellOutput();
                    if (output) {
                        if (
                            this.waitingForLastOutputMessage?.expectedString &&
                            data.includes(this.waitingForLastOutputMessage.expectedString)
                        ) {
                            data = data.replace(`${this.waitingForLastOutputMessage.expectedString}${EOL}`, '');
                            data = data.replace(`${this.waitingForLastOutputMessage.expectedString}`, '');
                            this.waitingForLastOutputMessage.deferred.resolve();
                            this.trace('stdout completion marker received; request=%s', this.currentTask?.requestId);
                        }
                        output.appendStreamOutput(data, 'stdout');
                    }
                } else {
                    ServerLogger.append(data);
                }
            });
        });
    }
    private async sendMessage(message: RequestType) {
        this.trace('send waiting; type=%s request=%s', message.type, message.requestId);
        await this.start();
        const ws = await this.webSocket.promise;
        ws.send(JSON.stringify(message));
        this.trace('sent; type=%s request=%s readyState=%s', message.type, message.requestId, ws.readyState);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private onMessage(message: ResponseType) {
        this.trace('received; type=%s request=%s', message.type, message.requestId);
        switch (message.type) {
            case 'pong':
                break;
            case 'logMessage': {
                ServerLogger.appendLine(message.message);
                break;
            }
            case 'initialized': {
                this.startHandlingStreamOutput = true;
                break;
            }
            case 'replRestarted': {
                void window.showErrorMessage('JavaScript/TypeScript Notebook Kernel was restarted');
                break;
            }
            case 'readlineRequest': {
                window.showInputBox({ ignoreFocusOut: true, prompt: message.question }).then((result) => {
                    void this.sendMessage({ type: 'readlineResponse', answer: result, requestId: message.requestId });
                }, noop);
                break;
            }
            case 'tensorFlowVis': {
                if (
                    getConfiguration().inlineTensorflowVisualizations &&
                    (message.request === 'history' ||
                        message.request === 'scatterplot' ||
                        message.request === 'linechart' ||
                        message.request === 'heatmap' ||
                        message.request === 'layer' ||
                        message.request === 'valuesdistribution' ||
                        // message.request === 'registerfitcallback' || // Disabled, as VSC is slow to display the output.
                        // message.request === 'fitcallback' || // Disabled, as VSC is slow to display the output.
                        message.request === 'table' ||
                        message.request === 'perclassaccuracy' ||
                        message.request === 'histogram' ||
                        message.request === 'barchart' ||
                        message.request === 'confusionmatrix' ||
                        message.request === 'modelsummary')
                ) {
                    const item = this.tasks.get(message.requestId)?.stdOutput || this.getCellOutput();
                    if (item) {
                        item.appendTensorflowVisOutput(message);
                    }
                }
                TensorflowVisClient.sendMessage(message);
                break;
            }
            case 'cellExec': {
                this.trace('execution response; request=%s success=%s result=%s markerReceived=%s error=%s', message.requestId, message.success, message.success ? message.result?.type : undefined, this.waitingForLastOutputMessage?.deferred.completed, message.success ? undefined : message.ex);
                const item = this.tasks.get(message.requestId);
                if (item) {
                    const outputCompleted = this.waitingForLastOutputMessage?.deferred.promise || Promise.resolve();
                    void outputCompleted
                        .then(async () => {
                            this.trace('request=%s output barrier passed; appending result and ending cell', message.requestId);
                            if (message.success && message.result) {
                                item.stdOutput.appendOutput(message.result);
                            }
                            if (message.success === false && message.ex) {
                                const error = new Error(message.ex.message || 'unknown');
                                error.name = message.ex.name || error.name;
                                error.stack = message.ex.stack || error.stack;
                                item.stdOutput.appendError(error);
                            }
                            await item.stdOutput.end(message.success, message.end || Date.now());
                            if (this.currentTask?.task === item.task) {
                                this.currentTask = undefined;
                            }
                            this.tasks.delete(message.requestId);
                            item.result.resolve(message.success ? CellExecutionState.success : CellExecutionState.error);
                            this.trace('request=%s cell completed; success=%s', message.requestId, message.success);
                        })
                        .catch((error: unknown) => {
                            ServerLogger.appendLine('Failed to finish cell execution:', error);
                            item.result.reject(error);
                        });
                } else {
                    this.trace('execution response has no matching task; request=%s', message.requestId);
                }
                break;
            }
            case 'output': {
                const item = this.tasks.get(message.requestId)?.stdOutput || this.getCellOutput();
                if (item) {
                    if (message.data) {
                        item.appendOutput(message.data);
                    }
                    if (message.ex) {
                        item.appendError(message.ex as unknown as Error);
                    }
                }
                break;
            }
            default:
                break;
        }
    }
    private getCellOutput() {
        return this.currentTask?.stdOutput || this.lastStdOutput;
    }
    private getPort() {
        const allocation = getPortsPromise.then(async () => {
            let port = await getPort();
            while (usedPorts.has(port)) {
                port = await getPort();
            }
            usedPorts.add(port);
            return port;
        });
        getPortsPromise = allocation.then(noop, noop);
        return allocation;
    }
}
