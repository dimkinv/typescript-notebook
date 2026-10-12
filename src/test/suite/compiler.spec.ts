import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NotebookCell, NotebookDocument } from 'vscode';
import { Compiler } from '../../extension/kernel/compiler';

jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });

describe('Notebook Node.js type diagnostics', () => {
    let directory: string;
    let getCellsMock: jest.Mock;
    let getTextMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-types-'));
        getCellsMock = jest.fn();
        getTextMock = jest.fn();
        fs.writeFileSync(
            path.join(directory, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { lib: ['esnext'], types: [], strict: true, skipLibCheck: true } })
        );
    });

    afterEach(() => {
        fs.rmdirSync(directory, { recursive: true });
    });

    function notebook(source: string): NotebookDocument {
        getTextMock.mockReturnValue(source);
        getCellsMock.mockReturnValue([
            { index: 0, document: { languageId: 'typescript', getText: getTextMock } } as unknown as NotebookCell
        ]);
        return {
            isUntitled: false,
            uri: { fsPath: path.join(directory, 'sample.nnb') },
            getCells: getCellsMock
        } as unknown as NotebookDocument;
    }

    it('recognizes Node globals and built-in modules without project types or DOM', () => {
        const document = notebook(
            [
                'console.log(process.version, Buffer.from("test"), __dirname, __filename);',
                'clearTimeout(setTimeout(() => {}, 1));',
                'clearInterval(setInterval(() => {}, 1));',
                'clearImmediate(setImmediate(() => {}));',
                'queueMicrotask(() => {});',
                'const url = new URL("https://example.com");',
                'fetch(url); structuredClone({ value: 1 });',
                'new TextEncoder().encode("test"); new AbortController();',
                'Promise.resolve(new Map<string, Set<number>>());',
                'import { readFileSync } from "node:fs";',
                'readFileSync(__filename); require("path");'
            ].join('\n')
        );

        expect(Compiler.getTypeDiagnostics(document, true)).toEqual([]);
    });

    it('still reports genuine type errors', () => {
        const document = notebook('console.log("test"); const value: string = 42;');

        expect(Compiler.getTypeDiagnostics(document, true).map((diagnostic) => diagnostic.code)).toEqual([2322]);
    });

    it('does not introduce browser-only globals', () => {
        const document = notebook('document.querySelector("body");');

        expect(Compiler.getTypeDiagnostics(document, true).map((diagnostic) => diagnostic.code)).toEqual([2584]);
    });

    it('prefers the notebook project Node declarations', () => {
        const typesDirectory = path.join(directory, 'node_modules', '@types', 'node');
        fs.mkdirSync(typesDirectory, { recursive: true });
        fs.writeFileSync(path.join(typesDirectory, 'index.d.ts'), 'declare const projectNodeVersion: "custom";');
        const document = notebook('const version: "custom" = projectNodeVersion;');

        expect(Compiler.getTypeDiagnostics(document, true)).toEqual([]);
    });
});
