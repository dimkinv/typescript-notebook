import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import init from '../../extension/typescriptPlugin';

describe('Notebook editor Node.js types', () => {
    let directory: string;
    let session: ts.server.Session<string>;
    let requireMock: jest.Mock;
    let closeMock: jest.Mock;
    let logMock: jest.Mock;
    let requestSequence: number;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-editor-types-'));
        requireMock = jest.fn().mockReturnValue({ module: init, error: undefined });
        closeMock = jest.fn();
        logMock = jest.fn();
        requestSequence = 0;
    });

    afterEach(() => {
        session.exit();
        jest.useRealTimers();
        fs.rmdirSync(directory, { recursive: true });
    });

    function start(enablePlugin: boolean) {
        const host: ts.server.ServerHost = {
            ...ts.sys,
            write: jest.fn(),
            getCurrentDirectory: () => directory,
            watchFile: jest.fn().mockReturnValue({ close: closeMock }),
            watchDirectory: jest.fn().mockReturnValue({ close: closeMock }),
            setTimeout,
            clearTimeout,
            setImmediate,
            clearImmediate,
            require: requireMock
        };
        const logger: ts.server.Logger = {
            close: closeMock,
            hasLevel: () => false,
            loggingEnabled: () => false,
            perftrc: logMock,
            info: logMock,
            startGroup: logMock,
            endGroup: logMock,
            msg: logMock,
            getLogFileName: () => undefined
        };
        session = new ts.server.Session({
            host,
            logger,
            cancellationToken: ts.server.nullCancellationToken,
            useSingleInferredProject: false,
            useInferredProjectPerProjectRoot: true,
            byteLength: Buffer.byteLength,
            hrtime: process.hrtime,
            canUseEvents: false,
            globalPlugins: enablePlugin ? ['typescript-notebook-plugin'] : [],
            pluginProbeLocations: [path.resolve(__dirname, '../../..')]
        });
        command('compilerOptionsForInferredProjects', {
            options: { lib: ['esnext'], types: [], skipLibCheck: true, target: 'esnext' }
        });
    }

    function command(name: string, args: Record<string, unknown>): ts.server.HandlerResponse['response'] {
        return session.executeCommand({
            seq: ++requestSequence,
            type: 'request',
            command: name,
            arguments: args
        }).response;
    }

    function open(source: string, notebook = true): string {
        const file = notebook
            ? `^/vscode-notebook-cell/ts-nul-authority${directory}/sample.nnb#ch0000001`
            : path.join(directory, 'sample.ts');
        command('open', { file, fileContent: source, scriptKindName: 'TS', projectRootPath: directory });
        return file;
    }

    it('reproduces the editor console error without the plugin', () => {
        start(false);
        const file = open('console.log("test");');

        expect(command('semanticDiagnosticsSync', { file })).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 2584 })])
        );
    });

    it('recognizes Node and JavaScript APIs in real notebook-cell projects', () => {
        start(true);
        const file = open(
            [
                'console.log(process.version, Buffer.from("test"), __dirname);',
                'clearTimeout(setTimeout(() => {}, 1));',
                'clearInterval(setInterval(() => {}, 1));',
                'clearImmediate(setImmediate(() => {}));',
                'queueMicrotask(() => {}); structuredClone({ value: 1 });',
                'fetch(new URL("https://example.com"));',
                'new TextEncoder(); new AbortController(); Promise.resolve(new Map());',
                'import { readFileSync } from "node:fs"; readFileSync(__filename);'
            ].join('\n')
        );

        expect(requireMock).toHaveBeenCalled();
        expect(logMock.mock.calls.filter(([message]) => /exception|failed|Skipped/.test(message))).toEqual([]);
        expect(command('semanticDiagnosticsSync', { file })).toEqual([]);
        expect(command('quickinfo', { file, line: 1, offset: 2 })).toMatchObject({
            displayString: expect.stringContaining('Console')
        });
    });

    it('preserves genuine errors and does not supply browser-only globals', () => {
        start(true);
        const file = open('console.log("test"); const value: string = 42; document.querySelector("body");');

        expect(command('semanticDiagnosticsSync', { file })).toEqual([
            expect.objectContaining({ code: 2322 }),
            expect.objectContaining({ code: 2584 })
        ]);
    });

    it('does not add Node globals to unrelated TypeScript projects', () => {
        start(true);
        const file = open('console.log(process.version);', false);

        expect(command('semanticDiagnosticsSync', { file })).toEqual([
            expect.objectContaining({ code: 2584 }),
            expect.objectContaining({ code: 2591 })
        ]);
    });

    it('prefers Node declarations installed alongside the notebook', () => {
        const typesDirectory = path.join(directory, 'node_modules', '@types', 'node');
        fs.mkdirSync(typesDirectory, { recursive: true });
        fs.writeFileSync(path.join(typesDirectory, 'index.d.ts'), 'declare const projectNodeVersion: "custom";');
        start(true);
        const file = open('const version: "custom" = projectNodeVersion;');

        expect(command('semanticDiagnosticsSync', { file })).toEqual([]);
    });
});
