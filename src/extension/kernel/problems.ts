import {
    Diagnostic,
    DiagnosticSeverity,
    ExtensionContext,
    languages,
    NotebookDocument,
    Position,
    Range,
    workspace
} from 'vscode';
import { IDisposable } from '../types';
import { disposeAllDisposables } from '../utils';
import { parse as parseStack } from 'error-stack-parser';
import type ErrorStackParser from 'error-stack-parser';
import { Compiler } from './compiler';

const runtimeDiagnosticsCollection = languages.createDiagnosticCollection('TypeScript Notebook Runtime');
const typeDiagnosticsCollection = languages.createDiagnosticCollection('TypeScript Notebook');
const pendingChecks = new Map<string, NodeJS.Timeout>();

export class CellDiagnosticsProvider {
    private readonly disposables: IDisposable[] = [];
    public static register(context: ExtensionContext) {
        context.subscriptions.push(
            new CellDiagnosticsProvider(),
            workspace.onDidCloseNotebookDocument((notebook) => CellDiagnosticsProvider.clearErrors(notebook)),
            workspace.onDidOpenNotebookDocument((notebook) => CellDiagnosticsProvider.scheduleTypeCheck(notebook)),
            workspace.onDidOpenTextDocument((document) => {
                const notebook = workspace.notebookDocuments.find((item) =>
                    item.getCells().some((cell) => cell.document.uri.toString() === document.uri.toString())
                );
                if (notebook) {
                    CellDiagnosticsProvider.scheduleTypeCheck(notebook);
                }
            }),
            workspace.onDidChangeTextDocument((event) => {
                const notebook = workspace.notebookDocuments.find((item) =>
                    item.getCells().some((cell) => cell.document.uri.toString() === event.document.uri.toString())
                );
                if (notebook) {
                    CellDiagnosticsProvider.scheduleTypeCheck(notebook);
                }
            })
        );
        workspace.notebookDocuments.forEach((notebook) => CellDiagnosticsProvider.scheduleTypeCheck(notebook));
    }
    public dispose() {
        runtimeDiagnosticsCollection.dispose();
        typeDiagnosticsCollection.dispose();
        pendingChecks.forEach((timer) => clearTimeout(timer));
        pendingChecks.clear();
        disposeAllDisposables(this.disposables);
    }

    public static clearErrors(notebook: NotebookDocument) {
        const pendingCheck = pendingChecks.get(notebook.uri.toString());
        if (pendingCheck) {
            clearTimeout(pendingCheck);
            pendingChecks.delete(notebook.uri.toString());
        }
        notebook.getCells().forEach((cell) => {
            runtimeDiagnosticsCollection.delete(cell.document.uri);
            typeDiagnosticsCollection.delete(cell.document.uri);
        });
    }
    public static clearRuntimeErrors(notebook: NotebookDocument) {
        notebook.getCells().forEach((cell) => runtimeDiagnosticsCollection.delete(cell.document.uri));
    }
    public static scheduleTypeCheck(notebook: NotebookDocument) {
        if (notebook.notebookType !== 'node-notebook-extended') {
            return;
        }
        const key = notebook.uri.toString();
        const pendingCheck = pendingChecks.get(key);
        if (pendingCheck) {
            clearTimeout(pendingCheck);
        }
        pendingChecks.set(
            key,
            setTimeout(() => {
                pendingChecks.delete(key);
                CellDiagnosticsProvider.checkTypes(notebook);
            }, 250)
        );
    }
    public static checkTypes(notebook: NotebookDocument): boolean {
        notebook.getCells().forEach((cell) => typeDiagnosticsCollection.delete(cell.document.uri));
        const mode = workspace.getConfiguration('node_notebook_extended', notebook.uri).get<'off' | 'on' | 'strict'>(
            'typeChecking',
            'on'
        );
        if (mode === 'off') {
            return true;
        }
        const diagnosticsByCell = new Map<string, Diagnostic[]>();
        Compiler.getTypeDiagnostics(notebook, mode === 'strict').forEach((item) => {
            const start = item.cell.document.positionAt(item.start);
            const end = item.cell.document.positionAt(item.start + item.length);
            const diagnostic = new Diagnostic(new Range(start, end), item.message, mapDiagnosticSeverity(item.category));
            diagnostic.code = item.code;
            diagnostic.source = 'TypeScript';
            const key = item.cell.document.uri.toString();
            const diagnostics = diagnosticsByCell.get(key) || [];
            diagnostics.push(diagnostic);
            diagnosticsByCell.set(key, diagnostics);
        });
        notebook.getCells().forEach((cell) => {
            typeDiagnosticsCollection.set(cell.document.uri, diagnosticsByCell.get(cell.document.uri.toString()) || []);
        });
        return Array.from(diagnosticsByCell.values()).every((diagnostics) =>
            diagnostics.every((diagnostic) => diagnostic.severity !== DiagnosticSeverity.Error)
        );
    }
    public static displayErrorsAsProblems(notebook: NotebookDocument, ex?: Partial<Error>) {
        // At any point we can only have one execution that results in an error for a notebook.
        // Thus all of the old problems are no longer valid, hence clear everything for this notebook.
        CellDiagnosticsProvider.clearRuntimeErrors(notebook);
        if (!ex || !ex?.stack) {
            return;
        }
        let stacks: ErrorStackParser.StackFrame[] = [];
        try {
            stacks = parseStack(ex as Error);
        } catch (ex) {
            // TODO: Seems to fail in windows.
            console.error('Failed to parse Stack trace', ex);
            return;
        }
        if (stacks.length === 0) {
            return;
        }
        // We're only interested in where the error is (not where a particular function was invoked from).
        // Hence take the top most stack.
        const stack = stacks[0];
        const cell = stack.fileName && Compiler.getCellFromTemporaryPath(stack.fileName);
        if (!cell) {
            return;
        }
        const codeObject = Compiler.getCodeObject(cell);
        if (!codeObject) {
            return;
        }
        const sourceMap = Compiler.getSourceMapsInfo(codeObject);
        if (!sourceMap) {
            return;
        }
        const line = stack.lineNumber || 1;
        const column = stack.columnNumber || 1;
        const mappedLocation = Compiler.getMappedLocation(codeObject, { line, column }, 'DAPToVSCode');
        if (typeof mappedLocation.column !== 'number' || typeof mappedLocation.line !== 'number') {
            return;
        }
        const position = new Position(mappedLocation.line - 1, mappedLocation.column);
        const wordRange = cell.document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return;
        }
        const diagnostic = new Diagnostic(wordRange, ex.message || '', DiagnosticSeverity.Error);
        runtimeDiagnosticsCollection.set(cell.document.uri, [diagnostic]);
    }
}

function mapDiagnosticSeverity(category: import('typescript').DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case 0:
            return DiagnosticSeverity.Warning;
        case 2:
            return DiagnosticSeverity.Warning;
        case 3:
            return DiagnosticSeverity.Information;
        default:
            return DiagnosticSeverity.Error;
    }
}
