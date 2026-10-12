# Changelog

## 0.1.7 (12 October 2026)
* Fix the renamed TensorFlow renderer ID used by every cell's output handler.
* Wait for VS Code to append expression and error outputs before ending execution.
* Verify that TypeScript diagnostics do not block cell execution.

## 0.1.6 (12 October 2026)
* Add timestamped kernel lifecycle and per-cell execution logs with request IDs.
* Log notebook type diagnostics and output completion events for troubleshooting.

## 0.1.5 (12 October 2026)
* Fix CommonJS imports in the production kernel bundle so cell execution can start.
* Report startup failures as cell errors instead of leaving cells pending.
* Avoid blocking subsequent port allocations after an allocation fails.
* Add regression coverage for function results and kernel startup failures.

## 0.1.4 (12 October 2026)
* Wait for console output to arrive and be appended before completing a notebook cell.
* Close kernel WebSocket connections when stopping the kernel.
* Add a real-kernel regression test with delayed stdout delivery.

## 0.1.3 (12 October 2026)
* Supply Node.js declarations to VS Code's TypeScript language service for notebook cells, fixing missing globals such as `console`, `process`, and `Buffer`.
* Prefer project Node.js types and fall back to bundled declarations without adding browser-only globals.
* Add regression tests for notebook editor diagnostics and hover information.

## 0.1.1 (7 October 2026)
* Emit TypeScript decorator metadata so frameworks such as NestJS can use constructor dependency injection in notebooks.
* Add a NestJS sample notebook that installs dependencies, starts an HTTP application, verifies a route, and shuts it down.
* Add regression coverage for emitted dependency-injection metadata.

## 0.1.0 (16 September 2026)
* First release of Node.js Notebooks Extended, maintained by Danny Vernovsky.
* Based on Node.js Notebooks by Don Jayamanne under the MIT License.
* Add configurable, notebook-wide TypeScript type checking across cells.
* Use distinct extension, command, renderer, view, and configuration identifiers.

## 2.0.5 (8 Nov 2021)
* Ensure it works in WSL (https://github.com/DonJayamanne/typescript-notebook/issues/44)

## 2.0.4 (12 Oct 2021)
* Support for a REPL (Interactive Window) experience (https://github.com/DonJayamanne/typescript-notebook/issues/37)
* Fix typescript compilation (https://github.com/DonJayamanne/typescript-notebook/issues/40)
* Updates to TypeScript 4.4.4

## 2.0.3 (12 Sept 2021)
* Support for user input in notebooks using [readline](https://nodejs.org/api/readline.html#readline_readline_createinterface_options)
* Update samples to use `isomorphic-fetch` instead of `node-fetch` (and pre-requisite `npm` packages).

## 2.0.2 (6 Sept 2021)
* Excellent support for [arquero](https://uwdata.github.io/arquero/) (rich HTML output)
* New notebooks default cells to `typescript`
* Displaying cell execution errors on Linux
* Display `Tensorflow Visualization` panel only when required.
* Ability to always hide `Tensorflow Visualization` panel via the setting `"node_notebook.disableTensorflowVis": true`

## 2.0.1 (2 Sept 2021)
* Updated readme

## 2.0.0 (2 Sept 2021)
* Run & debug JavaScript, TypeScript code in node.js
* Built in support for typescript (ships with [TypeScript](https://www.typescriptlang.org/) & [ts-node](https://typestrong.org/ts-node/)).
* Built in support for [plotly](https://plotly.com/javascript/) (plotly.js is shipped with the extension)
* Rich (inline visualizations) using [@tensorflow/tfjs-vis](https://www.npmjs.com/package/@tensorflow/tfjs-vis) & [Tensorboards](https://www.tensorflow.org/tensorboard)
* Excellent support for [danfo.js](https://danfo.jsdata.org/) (rich HTML output and plots)
* Run shell scripts within the notebook cell.
* Quickly prototype and view HTML/JavaScript/CSS output
