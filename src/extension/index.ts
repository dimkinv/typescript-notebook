import { ContentProvider } from './content';
import { registerDisposableRegistry } from './utils';
import { ExtensionContext } from 'vscode';
import { Controller } from './kernel';
import { ServerLogger } from './serverLogger';
import { TensorflowVisClient } from './tfjsvis';
import { DebuggerCommands } from './kernel/debugger/commands';
import { DebuggerFactory } from './kernel/debugger/debugFactory';
import { PlotlyDownloadRenderer } from './kernel/plotly';
import { ShellKernel } from './kernel/shellKernel';
import { JavaScriptKernel } from './kernel/jsKernel';
import { Compiler } from './kernel/compiler';
import { Samples } from './content/walkThrough';
import { NodeRepl } from './kernel/repl';
import { CellDiagnosticsProvider } from './kernel/problems';

export async function activate(context: ExtensionContext) {
    registerDisposableRegistry(context);
    ServerLogger.register();
    ServerLogger.appendLine('Extension activated: root=%s node=%s platform=%s', context.extensionUri.fsPath, process.version, process.platform);
    Samples.regsiter(context);
    Compiler.register(context);
    CellDiagnosticsProvider.register(context);
    ContentProvider.register(context);
    Controller.regsiter();
    TensorflowVisClient.register(context);
    DebuggerCommands.register(context);
    DebuggerFactory.regsiter(context);
    PlotlyDownloadRenderer.register(context);
    ShellKernel.register(context);
    JavaScriptKernel.register(context);
    NodeRepl.register(context);
}
