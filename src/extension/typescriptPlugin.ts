import type * as TypeScript from 'typescript';
import * as path from 'path';

function init({ typescript: ts }: { typescript: typeof TypeScript }): TypeScript.server.PluginModule {
    function getNodeDeclarations(project: TypeScript.server.Project): string[] {
        const notebookPaths = project.getRootScriptInfos().flatMap((info) => {
            const match = info.fileName.match(/(?:^|\/)vscode-notebook-cell\/[^/]+(\/.*\.nnb)(?:#.*)?$/i);
            return match ? [match[1].replace(/^\/([a-z]:\/)/i, '$1')] : [];
        });
        if (notebookPaths.length === 0) {
            return [];
        }

        const bundledTypes = path.resolve(__dirname, '../../resources/scripts/node_modules/@types/node/index.d.ts');
        const declarations = notebookPaths.map((notebookPath) => {
            const resolved = ts.resolveTypeReferenceDirective(
                'node',
                `${notebookPath}.ts`,
                project.getCompilerOptions(),
                project
            ).resolvedTypeReferenceDirective;
            const fileName = resolved?.resolvedFileName || bundledTypes;
            if (!project.fileExists(fileName)) {
                throw new Error(`Node.js notebook declarations are missing: ${fileName}`);
            }
            return fileName;
        });
        return Array.from(new Set(declarations));
    }

    return {
        create: (info) => {
            const getScriptFileNames = info.languageServiceHost.getScriptFileNames.bind(info.languageServiceHost);
            info.languageServiceHost.getScriptFileNames = () =>
                Array.from(new Set([...getScriptFileNames(), ...getNodeDeclarations(info.project)]));
            return info.languageService;
        },
        getExternalFiles: getNodeDeclarations
    };
}

export default init;
