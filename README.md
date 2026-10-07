# Node.js Notebooks Extended (REPL)

> This project is a maintained fork of [Node.js Notebooks](https://github.com/DonJayamanne/typescript-notebook), originally created by Don Jayamanne. The majority of the original implementation is his work. This fork adds continued maintenance, compatibility updates, and notebook-wide TypeScript type checking. It remains available under the MIT License.

## Features
* Enhanced REPL experience for Node.js in Notebooks (with top level awaits)
* Run & debug JavaScript, TypeScript code in node.js
* Type-check TypeScript across cells using the nearest `tsconfig.json`
* Built in support for typescript (ships with [TypeScript](https://www.typescriptlang.org/) & [ts-node](https://typestrong.org/ts-node/)).
* Built in support for [plotly](https://plotly.com/javascript/) (plotly.js is shipped with the extension)
* Rich (inline visualizations) using [@tensorflow/tfjs-vis](https://www.npmjs.com/package/@tensorflow/tfjs-vis) & [Tensorboards](https://www.tensorflow.org/tensorboard)
* Excellent support for [danfo.js](https://danfo.jsdata.org/) (rich HTML output and plots)
* Excellent support for [arquero](https://uwdata.github.io/arquero/) (rich HTML output)
* Run shell scripts within the notebook cell.
* Quickly prototype and view HTML/JavaScript/CSS output
* Support for user input using [readline](https://nodejs.org/api/readline.html#readline_readline_createinterface_options)
* Run decorator-based frameworks such as NestJS, including constructor dependency injection.


Packages such [plotly](https://plotly.com/javascript/), [tfjs-vis](https://www.npmjs.com/package/@tensorflow/tfjs-vis) & [danfo.js](https://danfo.jsdata.org/) support rich visualization only in the browser,
however, this extension leverages the power of Notebooks to provide the same rich visualizations when targeting node.js.

Use the command `Open a sample node.js notebook` to open a sample notebook to get started with plotly.js, danfo.js, tensorflow.js, etc.

## Getting started
* For a REPL experience use the command `Open Node.js REPL`
    * Consider installing the [Jupyter](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) extension for an enhance user interface (toolbars).
* For a notebook experience, create a file with the extension `*.nnb`, e.g. `sample.nnb`
    * Or use the menu item `New File...` to create a Node.js notebook


![Repl](https://raw.githubusercontent.com/DonJayamanne/typescript-notebook/main/images/REPL.gif)
![Demo](https://raw.githubusercontent.com/DonJayamanne/typescript-notebook/main/images/demo.gif)


## Examples
* Use the command `Open a sample node.js notebook` to open a sample notebook.
* Use the command `Welcome: Open Walkthrough...` to checkout the samples.

## Requirements
* node.js >= 12
* node.js needs to be in the current path

## Type checking
Type checking is enabled by default for TypeScript cells and follows document order. Configure **Node.js Notebooks Extended: Type Checking** as `off`, `on`, or `strict`. The `on` mode uses the nearest `tsconfig.json`, while `strict` additionally forces TypeScript strict mode.

This fork retains support for `*.nnb` files. Disable the original extension when using this fork to avoid both extensions claiming the same file type.

## Roadmap
* Open a plain js/ts file as a notebook & vice versa.
* Better renderers for tabular data (arquero, danfo.js, etc)
* [Vega](https://vega.github.io/vega/) plots without having to install vega
* Custom node arguments


### Known issues, workarounds and technical details
* See [here](https://github.com/DonJayamanne/typescript-notebook/wiki/Kernel-behaviour-(known-issues-&-workarounds)) for more details


## Thanks
Thanks to the various packages we provide integrations with which help make this extension useful:
* [ts-node](https://typestrong.org/ts-node/)
* [Tensorflow.js](https://www.tensorflow.org/js)
* [plotly](https://plotly.com/javascript/)
* [danfo.js](https://danfo.jsdata.org/)
* [node-pty](https://github.com/microsoft/node-pty)
* [arquero](https://uwdata.github.io/arquero/)
