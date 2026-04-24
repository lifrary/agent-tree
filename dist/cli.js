#!/usr/bin/env node
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/commander/lib/error.js"(exports) {
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/commander/lib/argument.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.length > 3 && this._name.slice(-3) === "...") {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/commander/lib/help.js"(exports) {
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a, b) => {
            return a.name().localeCompare(b.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(max, helper.subcommandTerm(command).length);
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(max, helper.argumentTerm(argument).length);
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescripton = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescripton}`;
          }
          return extraDescripton;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
        }
        let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.wrap(commandDescription, helpWidth, 0),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return formatItem(
            helper.argumentTerm(argument),
            helper.argumentDescription(argument)
          );
        });
        if (argumentList.length > 0) {
          output = output.concat(["Arguments:", formatList(argumentList), ""]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          );
        });
        if (optionList.length > 0) {
          output = output.concat(["Options:", formatList(optionList), ""]);
        }
        if (this.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option)
            );
          });
          if (globalOptionList.length > 0) {
            output = output.concat([
              "Global Options:",
              formatList(globalOptionList),
              ""
            ]);
          }
        }
        const commandList = helper.visibleCommands(cmd).map((cmd2) => {
          return formatItem(
            helper.subcommandTerm(cmd2),
            helper.subcommandDescription(cmd2)
          );
        });
        if (commandList.length > 0) {
          output = output.concat(["Commands:", formatList(commandList), ""]);
        }
        return output.join("\n");
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str2, width, indent, minColumnWidth = 40) {
        const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
        const manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str2.match(manualIndent)) return str2;
        const columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str2;
        const leadingStr = str2.slice(0, indent);
        const columnText = str2.slice(indent).replace("\r\n", "\n");
        const indentString2 = " ".repeat(indent);
        const zeroWidthSpace = "\u200B";
        const breaks = `\\s${zeroWidthSpace}`;
        const regex = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        );
        const lines = columnText.match(regex) || [];
        return leadingStr + lines.map((line, i) => {
          if (line === "\n") return "";
          return (i > 0 ? indentString2 : "") + line.trimEnd();
        }).join("\n");
      }
    };
    exports.Help = Help2;
  }
});

// node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/commander/lib/option.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str2) {
      return str2.split("-").reduce((str3, word) => {
        return str3 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const flagParts = flags.split(/[ |,]+/);
      if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
        shortFlag = flagParts.shift();
      longFlag = flagParts.shift();
      if (!shortFlag && /^-[^-]$/.test(longFlag)) {
        shortFlag = longFlag;
        longFlag = void 0;
      }
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/commander/lib/suggestSimilar.js"(exports) {
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d = [];
      for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
      }
      for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
      }
      for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          }
        }
      }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a, b) => a.localeCompare(b));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports.suggestSimilar = suggestSimilar;
  }
});

// node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/commander/lib/command.js"(exports) {
    var EventEmitter = __require("node:events").EventEmitter;
    var childProcess = __require("node:child_process");
    var path = __require("node:path");
    var fs = __require("node:fs");
    var process2 = __require("node:process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = true;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._outputConfiguration = {
          writeOut: (str2) => process2.stdout.write(str2),
          writeErr: (str2) => process2.stderr.write(str2),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          outputError: (str2, write) => write(str2)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof fn === "function") {
          argument.default(defaultValue).argParser(fn);
        } else {
          argument.default(fn);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          return this;
        }
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._concatValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m = regex.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process2.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv[1];
              userArgs = argv.slice(2);
            } else {
              userArgs = argv.slice(1);
            }
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path.resolve(baseDir, baseName);
          if (fs.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs.realpathSync(this._scriptPath);
          } catch (err) {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path.resolve(
            path.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path.basename(
              this._scriptPath,
              path.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
            const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
            throw new Error(executableMissing);
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v) => {
                  return myParseArg(declaredArg, v, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        const args = argv.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        while (args.length) {
          const arg = args.shift();
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args.shift();
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (args.length > 0 && !maybeOption(args[0])) {
                  value = args.shift();
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                args.unshift(`-${arg.slice(2)}`);
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg)) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str2, flags, description) {
        if (str2 === void 0) return this._version;
        this._version = str2;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str2}
`);
          this._exit(0, "commander.version", str2);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str2, argsDescription) {
        if (str2 === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str2;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str2) {
        if (str2 === void 0) return this._summary;
        this._summary = str2;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str2) {
        if (str2 === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str2;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str2) {
        if (str2 === void 0) return this._name;
        this._name = str2;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path.basename(filename, path.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path2) {
        if (path2 === void 0) return this._executableDir;
        this._executableDir = path2;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        if (helper.helpWidth === void 0) {
          helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
        }
        return helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
      _getHelpContext(contextOptions) {
        contextOptions = contextOptions || {};
        const context = { error: !!contextOptions.error };
        let write;
        if (context.error) {
          write = (arg) => this._outputConfiguration.writeErr(arg);
        } else {
          write = (arg) => this._outputConfiguration.writeOut(arg);
        }
        context.write = contextOptions.write || write;
        context.command = this;
        return context;
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const context = this._getHelpContext(contextOptions);
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
        this.emit("beforeHelp", context);
        let helpInformation = this.helpInformation(context);
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        context.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", context);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
          } else {
            this._helpOption = null;
          }
          return this;
        }
        flags = flags ?? "-h, --help";
        description = description ?? "display help for command";
        this._helpOption = this.createOption(flags, description);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process2.exitCode || 0;
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text === "function") {
            helpStr = text({ error: context.error, command: context.command });
          } else {
            helpStr = text;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    exports.Command = Command2;
  }
});

// node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/commander/index.js"(exports) {
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// node_modules/js-yaml/dist/js-yaml.mjs
var js_yaml_exports = {};
__export(js_yaml_exports, {
  CORE_SCHEMA: () => CORE_SCHEMA,
  DEFAULT_SCHEMA: () => DEFAULT_SCHEMA,
  FAILSAFE_SCHEMA: () => FAILSAFE_SCHEMA,
  JSON_SCHEMA: () => JSON_SCHEMA,
  Schema: () => Schema,
  Type: () => Type,
  YAMLException: () => YAMLException,
  default: () => jsYaml,
  dump: () => dump,
  load: () => load,
  loadAll: () => loadAll,
  safeDump: () => safeDump,
  safeLoad: () => safeLoad,
  safeLoadAll: () => safeLoadAll,
  types: () => types
});
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
function compileList(schema2, name) {
  var result = [];
  schema2[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
  // Probably should update regexp & check speed
  data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null) throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat("\n", count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat("\n", emptyLines);
      }
    } else {
      state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33) return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38) return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42) return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = /* @__PURE__ */ Object.create(null);
  state.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0) readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\0";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return "\n" + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
          i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state.indent,
      lineWidth,
      testAmbiguity,
      state.quotingType,
      state.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  }();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = function() {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  }();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(
        state.tag[0] === "!" ? state.tag.slice(1) : state.tag
      ).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs) getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
  return "";
}
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
var isNothing_1, isObject_1, toArray_1, repeat_1, isNegativeZero_1, extend_1, common, exception, snippet, TYPE_CONSTRUCTOR_OPTIONS, YAML_NODE_KINDS, type, schema, str, seq, map, failsafe, _null, bool, int, YAML_FLOAT_PATTERN, SCIENTIFIC_WITHOUT_DOT, float, json, core, YAML_DATE_REGEXP, YAML_TIMESTAMP_REGEXP, timestamp, merge, BASE64_MAP, binary, _hasOwnProperty$3, _toString$2, omap, _toString$1, pairs, _hasOwnProperty$2, set, _default, _hasOwnProperty$1, CONTEXT_FLOW_IN, CONTEXT_FLOW_OUT, CONTEXT_BLOCK_IN, CONTEXT_BLOCK_OUT, CHOMPING_CLIP, CHOMPING_STRIP, CHOMPING_KEEP, PATTERN_NON_PRINTABLE, PATTERN_NON_ASCII_LINE_BREAKS, PATTERN_FLOW_INDICATORS, PATTERN_TAG_HANDLE, PATTERN_TAG_URI, simpleEscapeCheck, simpleEscapeMap, i, directiveHandlers, loadAll_1, load_1, loader, _toString, _hasOwnProperty, CHAR_BOM, CHAR_TAB, CHAR_LINE_FEED, CHAR_CARRIAGE_RETURN, CHAR_SPACE, CHAR_EXCLAMATION, CHAR_DOUBLE_QUOTE, CHAR_SHARP, CHAR_PERCENT, CHAR_AMPERSAND, CHAR_SINGLE_QUOTE, CHAR_ASTERISK, CHAR_COMMA, CHAR_MINUS, CHAR_COLON, CHAR_EQUALS, CHAR_GREATER_THAN, CHAR_QUESTION, CHAR_COMMERCIAL_AT, CHAR_LEFT_SQUARE_BRACKET, CHAR_RIGHT_SQUARE_BRACKET, CHAR_GRAVE_ACCENT, CHAR_LEFT_CURLY_BRACKET, CHAR_VERTICAL_LINE, CHAR_RIGHT_CURLY_BRACKET, ESCAPE_SEQUENCES, DEPRECATED_BOOLEANS_SYNTAX, DEPRECATED_BASE60_SYNTAX, QUOTING_TYPE_SINGLE, QUOTING_TYPE_DOUBLE, STYLE_PLAIN, STYLE_SINGLE, STYLE_LITERAL, STYLE_FOLDED, STYLE_DOUBLE, dump_1, dumper, Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump, jsYaml;
var init_js_yaml = __esm({
  "node_modules/js-yaml/dist/js-yaml.mjs"() {
    isNothing_1 = isNothing;
    isObject_1 = isObject;
    toArray_1 = toArray;
    repeat_1 = repeat;
    isNegativeZero_1 = isNegativeZero;
    extend_1 = extend;
    common = {
      isNothing: isNothing_1,
      isObject: isObject_1,
      toArray: toArray_1,
      repeat: repeat_1,
      isNegativeZero: isNegativeZero_1,
      extend: extend_1
    };
    YAMLException$1.prototype = Object.create(Error.prototype);
    YAMLException$1.prototype.constructor = YAMLException$1;
    YAMLException$1.prototype.toString = function toString(compact) {
      return this.name + ": " + formatError(this, compact);
    };
    exception = YAMLException$1;
    snippet = makeSnippet;
    TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "multi",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "representName",
      "defaultStyle",
      "styleAliases"
    ];
    YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    type = Type$1;
    Schema$1.prototype.extend = function extend2(definition) {
      var implicit = [];
      var explicit = [];
      if (definition instanceof type) {
        explicit.push(definition);
      } else if (Array.isArray(definition)) {
        explicit = explicit.concat(definition);
      } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
        if (definition.implicit) implicit = implicit.concat(definition.implicit);
        if (definition.explicit) explicit = explicit.concat(definition.explicit);
      } else {
        throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
      }
      implicit.forEach(function(type$1) {
        if (!(type$1 instanceof type)) {
          throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
        if (type$1.loadKind && type$1.loadKind !== "scalar") {
          throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
        if (type$1.multi) {
          throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
        }
      });
      explicit.forEach(function(type$1) {
        if (!(type$1 instanceof type)) {
          throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
      });
      var result = Object.create(Schema$1.prototype);
      result.implicit = (this.implicit || []).concat(implicit);
      result.explicit = (this.explicit || []).concat(explicit);
      result.compiledImplicit = compileList(result, "implicit");
      result.compiledExplicit = compileList(result, "explicit");
      result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
      return result;
    };
    schema = Schema$1;
    str = new type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
    seq = new type("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
    map = new type("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
    failsafe = new schema({
      explicit: [
        str,
        seq,
        map
      ]
    });
    _null = new type("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        },
        empty: function() {
          return "";
        }
      },
      defaultStyle: "lowercase"
    });
    bool = new type("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
    int = new type("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        /* eslint-disable max-len */
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
    YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    float = new type("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
    json = failsafe.extend({
      implicit: [
        _null,
        bool,
        int,
        float
      ]
    });
    core = json;
    YAML_DATE_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
    );
    YAML_TIMESTAMP_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    );
    timestamp = new type("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
    merge = new type("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
    BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    binary = new type("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
    _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
    _toString$2 = Object.prototype.toString;
    omap = new type("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
    _toString$1 = Object.prototype.toString;
    pairs = new type("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
    _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
    set = new type("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
    _default = core.extend({
      implicit: [
        timestamp,
        merge
      ],
      explicit: [
        binary,
        omap,
        pairs,
        set
      ]
    });
    _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
    CONTEXT_FLOW_IN = 1;
    CONTEXT_FLOW_OUT = 2;
    CONTEXT_BLOCK_IN = 3;
    CONTEXT_BLOCK_OUT = 4;
    CHOMPING_CLIP = 1;
    CHOMPING_STRIP = 2;
    CHOMPING_KEEP = 3;
    PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
    PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
    PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
    simpleEscapeCheck = new Array(256);
    simpleEscapeMap = new Array(256);
    for (i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        var match, major, minor;
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        major = parseInt(match[1], 10);
        minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args) {
        var handle, prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) {
          throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        }
        if (_hasOwnProperty$1.call(state.tagMap, handle)) {
          throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        }
        if (!PATTERN_TAG_URI.test(prefix)) {
          throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        }
        try {
          prefix = decodeURIComponent(prefix);
        } catch (err) {
          throwError(state, "tag prefix is malformed: " + prefix);
        }
        state.tagMap[handle] = prefix;
      }
    };
    loadAll_1 = loadAll$1;
    load_1 = load$1;
    loader = {
      loadAll: loadAll_1,
      load: load_1
    };
    _toString = Object.prototype.toString;
    _hasOwnProperty = Object.prototype.hasOwnProperty;
    CHAR_BOM = 65279;
    CHAR_TAB = 9;
    CHAR_LINE_FEED = 10;
    CHAR_CARRIAGE_RETURN = 13;
    CHAR_SPACE = 32;
    CHAR_EXCLAMATION = 33;
    CHAR_DOUBLE_QUOTE = 34;
    CHAR_SHARP = 35;
    CHAR_PERCENT = 37;
    CHAR_AMPERSAND = 38;
    CHAR_SINGLE_QUOTE = 39;
    CHAR_ASTERISK = 42;
    CHAR_COMMA = 44;
    CHAR_MINUS = 45;
    CHAR_COLON = 58;
    CHAR_EQUALS = 61;
    CHAR_GREATER_THAN = 62;
    CHAR_QUESTION = 63;
    CHAR_COMMERCIAL_AT = 64;
    CHAR_LEFT_SQUARE_BRACKET = 91;
    CHAR_RIGHT_SQUARE_BRACKET = 93;
    CHAR_GRAVE_ACCENT = 96;
    CHAR_LEFT_CURLY_BRACKET = 123;
    CHAR_VERTICAL_LINE = 124;
    CHAR_RIGHT_CURLY_BRACKET = 125;
    ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
    QUOTING_TYPE_SINGLE = 1;
    QUOTING_TYPE_DOUBLE = 2;
    STYLE_PLAIN = 1;
    STYLE_SINGLE = 2;
    STYLE_LITERAL = 3;
    STYLE_FOLDED = 4;
    STYLE_DOUBLE = 5;
    dump_1 = dump$1;
    dumper = {
      dump: dump_1
    };
    Type = type;
    Schema = schema;
    FAILSAFE_SCHEMA = failsafe;
    JSON_SCHEMA = json;
    CORE_SCHEMA = core;
    DEFAULT_SCHEMA = _default;
    load = loader.load;
    loadAll = loader.loadAll;
    dump = dumper.dump;
    YAMLException = exception;
    types = {
      binary,
      float,
      map,
      null: _null,
      pairs,
      set,
      timestamp,
      bool,
      int,
      merge,
      omap,
      seq,
      str
    };
    safeLoad = renamed("safeLoad", "load");
    safeLoadAll = renamed("safeLoadAll", "loadAll");
    safeDump = renamed("safeDump", "dump");
    jsYaml = {
      Type,
      Schema,
      FAILSAFE_SCHEMA,
      JSON_SCHEMA,
      CORE_SCHEMA,
      DEFAULT_SCHEMA,
      load,
      loadAll,
      dump,
      YAMLException,
      types,
      safeLoad,
      safeLoadAll,
      safeDump
    };
  }
});

// src/cli.ts
import { resolve as resolve4 } from "node:path";

// node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// src/cli/options.ts
var PKG_VERSION = (() => {
  try {
    return "0.1.0";
  } catch {
    return void 0;
  }
})() ?? "0.0.0-source";
function parseCliArgs(argv) {
  const program2 = new Command();
  program2.name("agent-tree").description(
    "Navigate a Claude Code session as a numbered file-tree in your terminal and resume from any node."
  ).version(PKG_VERSION, "-V, --version", "print agent-tree version").argument("[session-id]", "session UUID or short prefix (e.g. 69c2f35e)").option("--latest", "use the most recently modified session").option("--pick", "interactive picker over recent sessions").option("--no-llm", "skip LLM labeling and run heuristic-only").option("--dump-json <dir>", "dump intermediate artifacts (raw events / graph / segments / tree) as JSON").option("-v, --verbose", "debug logging").option("--trace", "trace logging (implies --verbose)").option("--dry-run", "run the analysis pipeline but do not emit any output").option(
    "--model <name>",
    "Anthropic model for LLM labeling",
    "claude-sonnet-4-6"
  ).option(
    "--max-llm-tokens <n>",
    "input token budget ceiling across segments",
    "50000"
  ).option("--redact-strict", "enable PII patterns (email/phone/SSN/RRN/card)").option("--redact-dryrun", "print redaction hit counts to stderr").option("--include-sidechains", "keep sidechain segments as a branch (default)").option("--flatten-sidechains", "merge sidechains into main tree").option("--drop-sidechains", "omit sidechain events entirely").option("--list", "print numbered ASCII tree to stdout (skill-friendly)").option("--snapshot <id>", "print single node's snapshot markdown to stdout").option(
    "--mode <continue|fork>",
    "snapshot mode (used with --snapshot)",
    "continue"
  ).option("--tui", "interactive readline prompt with numbered selection").option("--filter <kw>", "show only rows whose label/time/range matches keyword (case-insensitive)").option("--no-group", "do not collapse consecutive same-file rows").option("--no-color", "force-disable ANSI color even on TTY").option("--phases-only", "show only phase headers (user prompts), hide sub-actions").option("--picks", "list every pick across every session (no session arg needed)").option("--unstar <id>", "remove the \u2B50 from a previously-picked node").option(
    "--diff <ids...>",
    "summarise what happened between two nodes (numbers or n_NNN ids)"
  ).exitOverride();
  try {
    program2.parse(argv, { from: "node" });
    return {
      ok: true,
      opts: program2.opts(),
      sessionArg: program2.args[0]
    };
  } catch (err) {
    const commanderErr = err;
    if (commanderErr.code === "commander.helpDisplayed" || commanderErr.code === "commander.version") {
      return { ok: false, exitCode: 0 };
    }
    return { ok: false, exitCode: commanderErr.exitCode ?? 1 };
  }
}
function resolveMode(opts, isTty) {
  const utilityFlag = !!opts.picks || !!opts.unstar || !!opts.diff?.length;
  const flagSet = !!opts.list || !!opts.snapshot || !!opts.tui || utilityFlag;
  return {
    list: !!opts.list || !flagSet && !isTty,
    snapshot: !!opts.snapshot,
    tui: !!opts.tui || !flagSet && isTty,
    picks: !!opts.picks,
    unstar: !!opts.unstar,
    diff: !!opts.diff?.length
  };
}

// src/analyzer/signals.ts
var TOPIC_SHIFT_PATTERNS = [
  // Korean
  /\b이제\b/,
  /\b다음은\b/,
  /\b그럼\b/,
  /\b참고로\b/,
  /\b이번엔\b/,
  /\b이번에는\b/,
  // English — word-boundary, lowercase matched after .toLowerCase()
  /\bnow\b/,
  /\bnext\b/,
  /\bswitching to\b/,
  /let['’]s move\b/,
  /\bokay so\b/
];
function extractSignals(events) {
  const out = new Array(events.length);
  for (let i = 0; i < events.length; i += 1) {
    out[i] = extractOne(events[i], i);
  }
  return out;
}
function extractOne(e, index) {
  const timestamp2 = parseTs(e.timestamp);
  const text = extractText(e);
  const tools = extractTools(e);
  const files = extractFiles(e, tools);
  const slashCommand = extractSlashCommand(e, text);
  const hasTopicShiftPhrase = detectTopicShift(text);
  const isTurn = e.type === "user" || e.type === "assistant";
  return {
    index,
    uuid: e.uuid,
    timestamp: timestamp2,
    isSidechain: e.isSidechain,
    text,
    tools,
    files,
    slashCommand,
    hasTopicShiftPhrase,
    isTurn
  };
}
function parseTs(iso) {
  if (!iso) return NaN;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : NaN;
}
function extractText(e) {
  if (e.type !== "user" && e.type !== "assistant") return "";
  const msg = e.message;
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}
function extractTools(e) {
  const tools = [];
  if (e.type === "tool_use" && e.tool_use?.name) {
    tools.push(e.tool_use.name);
    return tools;
  }
  if (e.type === "assistant") {
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "tool_use" && typeof b.name === "string") tools.push(b.name);
      }
    }
  }
  return tools;
}
function extractFiles(e, tools) {
  const files = /* @__PURE__ */ new Set();
  const harvest = (input) => {
    if (!input || typeof input !== "object") return;
    const obj = input;
    const fp = obj.file_path ?? obj.path ?? obj.notebook_path;
    if (typeof fp === "string" && fp.length > 0) files.add(fp);
    const ps = obj.paths;
    if (Array.isArray(ps)) {
      for (const p of ps) if (typeof p === "string") files.add(p);
    }
  };
  if (e.type === "tool_use") {
    harvest(e.tool_use?.input);
  } else if (e.type === "assistant") {
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "tool_use") harvest(b.input);
      }
    }
  }
  return Array.from(files);
}
function extractSlashCommand(e, text) {
  if (e.type !== "user") return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.slice(1).match(/^([A-Za-z0-9_:-]+)/);
  return match ? match[1] : null;
}
function detectTopicShift(text) {
  if (!text) return false;
  const lowered = text.toLowerCase();
  for (const re of TOPIC_SHIFT_PATTERNS) {
    if (re.test(text) || re.test(lowered)) return true;
  }
  return false;
}
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// src/analyzer/segments.ts
var DEFAULTS = {
  gapMs: 5 * 60 * 1e3,
  fileJaccardThreshold: 0.3,
  turnForceSplit: 30,
  sidechainHandling: "include"
};
function detectSegments(events, opts = {}) {
  const {
    gapMs,
    fileJaccardThreshold,
    turnForceSplit,
    sidechainHandling
  } = { ...DEFAULTS, ...opts };
  const filtered = filterBySidechainMode(events, sidechainHandling);
  if (filtered.length === 0) return [];
  const signals = extractSignals(filtered);
  const segments = [];
  let current = null;
  let prevSignals = null;
  for (let i = 0; i < filtered.length; i += 1) {
    const sig = signals[i];
    const reasons = current ? detectBoundary(current, sig, prevSignals, {
      gapMs,
      fileJaccardThreshold,
      turnForceSplit
    }) : [];
    if (!current || reasons.length > 0) {
      if (current) segments.push(current);
      const gapBefore = computeGap(prevSignals, sig);
      current = startSegment(sig, reasons, gapBefore);
    }
    extendSegment(current, sig, filtered[i]);
    prevSignals = sig;
  }
  if (current) segments.push(current);
  const merged = mergeMicroSegments(segments);
  return merged.map((w, idx) => finalize(w, idx));
}
function mergeMicroSegments(segments) {
  if (segments.length <= 1) return segments;
  const out = [];
  let pending = null;
  for (const seg of segments) {
    if (pending) {
      seg.event_uuids = [...pending.event_uuids, ...seg.event_uuids];
      seg.start_index = pending.start_index;
      for (const [k, v] of pending.files) {
        seg.files.set(k, (seg.files.get(k) ?? 0) + v);
      }
      for (const [k, v] of pending.tools) {
        seg.tools.set(k, (seg.tools.get(k) ?? 0) + v);
      }
      seg.is_sidechain_only = seg.is_sidechain_only && pending.is_sidechain_only;
      seg.time_start = pending.time_start || seg.time_start;
      seg.gap_before_ms = pending.gap_before_ms;
      seg.turns += pending.turns;
      pending = null;
    }
    const isMicro = seg.event_uuids.length <= 1 && !seg.boundary_reasons.includes("sidechain_transition");
    if (isMicro) {
      pending = seg;
    } else {
      out.push(seg);
    }
  }
  if (pending) out.push(pending);
  return out;
}
function filterBySidechainMode(events, mode) {
  switch (mode) {
    case "drop":
      return events.filter((e) => !e.isSidechain);
    case "flatten":
    case "include":
    default:
      return events;
  }
}
function detectBoundary(current, sig, prev, opts) {
  const reasons = [];
  if (prev && Number.isFinite(sig.timestamp) && Number.isFinite(prev.timestamp)) {
    if (sig.timestamp - prev.timestamp > opts.gapMs) reasons.push("gap");
  }
  if (current.files.size > 0 && sig.files.length > 0) {
    const a = new Set(current.files.keys());
    const b = new Set(sig.files);
    const j = jaccard(a, b);
    if (j <= opts.fileJaccardThreshold) reasons.push("file_shift");
  }
  if (sig.hasTopicShiftPhrase) reasons.push("topic_shift_phrase");
  if (sig.slashCommand) reasons.push("slash_command");
  if (prev && prev.isSidechain !== sig.isSidechain) {
    reasons.push("sidechain_transition");
  }
  if (current.turns >= opts.turnForceSplit) reasons.push("turn_force_split");
  return reasons;
}
function startSegment(sig, reasons, gapBeforeMs) {
  return {
    start_index: sig.index,
    end_index: sig.index,
    event_uuids: [],
    files: /* @__PURE__ */ new Map(),
    tools: /* @__PURE__ */ new Map(),
    is_sidechain_only: true,
    time_start: "",
    time_end: "",
    gap_before_ms: gapBeforeMs,
    turns: 0,
    boundary_reasons: reasons
  };
}
function computeGap(prev, cur) {
  if (!prev) return 0;
  if (!Number.isFinite(prev.timestamp) || !Number.isFinite(cur.timestamp)) {
    return 0;
  }
  const diff = cur.timestamp - prev.timestamp;
  return diff > 0 ? diff : 0;
}
function extendSegment(seg, sig, ev) {
  seg.end_index = sig.index;
  seg.event_uuids.push(sig.uuid);
  for (const f of sig.files) seg.files.set(f, (seg.files.get(f) ?? 0) + 1);
  for (const t of sig.tools) seg.tools.set(t, (seg.tools.get(t) ?? 0) + 1);
  if (!ev.isSidechain) seg.is_sidechain_only = false;
  if (!seg.time_start) seg.time_start = ev.timestamp;
  if (ev.timestamp) seg.time_end = ev.timestamp;
  if (sig.isTurn) seg.turns += 1;
}
function finalize(w, idx) {
  const dominantFiles = topN(w.files, 5);
  const dominantTools = topN(w.tools, 5);
  return {
    id: `seg_${String(idx + 1).padStart(3, "0")}`,
    start_index: w.start_index,
    end_index: w.end_index,
    event_uuids: w.event_uuids,
    dominant_files: dominantFiles,
    dominant_tools: dominantTools,
    is_sidechain_only: w.is_sidechain_only,
    time_range: [w.time_start || "", w.time_end || ""],
    gap_before_ms: w.gap_before_ms,
    boundary_reasons: w.boundary_reasons
  };
}
function topN(counts, n) {
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

// src/cache/disk.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var DEFAULT_CACHE_ROOT = join(homedir(), ".cache", "agent-tree");
var MODE_RWX_OWNER = 448;
async function computeInputHash(inp) {
  const jsonlBytes = await readFile(inp.jsonlPath);
  const h = createHash("sha256");
  h.update(jsonlBytes);
  h.update("\0");
  h.update(inp.configJson);
  h.update("\0");
  h.update(inp.specVersion);
  return h.digest("hex");
}
async function ensureCacheDir(hash, opts = {}) {
  const root = opts.root ?? DEFAULT_CACHE_ROOT;
  await mkdir(root, { recursive: true, mode: MODE_RWX_OWNER });
  const dir = join(root, hash);
  await mkdir(dir, { recursive: true, mode: MODE_RWX_OWNER });
  return dir;
}
var MODE_RW_OWNER = 384;
async function writeJsonCache(hash, filename, value, opts = {}) {
  const dir = await ensureCacheDir(hash, opts);
  const p = join(dir, filename);
  await writeFile(p, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: MODE_RW_OWNER
  });
  return p;
}

// src/reader/graph.ts
function buildGraph(meta, events, opts = {}) {
  const { logger } = opts;
  const childrenOf = /* @__PURE__ */ new Map();
  const byUuid = /* @__PURE__ */ new Map();
  const roots = [];
  const seenUuids = /* @__PURE__ */ new Set();
  for (const e of events) seenUuids.add(e.uuid);
  for (const e of events) {
    if (byUuid.has(e.uuid)) {
      logger?.warn(`duplicate uuid in jsonl, later event overwrites earlier`, {
        uuid: e.uuid
      });
    }
    byUuid.set(e.uuid, e);
    if (e.parentUuid === null) {
      roots.push(e.uuid);
      continue;
    }
    if (e.parentUuid === e.uuid) {
      logger?.warn(`self-referencing parentUuid, treating as root`, {
        uuid: e.uuid
      });
      roots.push(e.uuid);
      continue;
    }
    if (!seenUuids.has(e.parentUuid)) {
      logger?.warn(`dangling parentUuid, treating as orphan root`, {
        uuid: e.uuid,
        parentUuid: e.parentUuid
      });
      roots.push(e.uuid);
      continue;
    }
    let bucket = childrenOf.get(e.parentUuid);
    if (!bucket) {
      bucket = [];
      childrenOf.set(e.parentUuid, bucket);
    }
    bucket.push(e.uuid);
  }
  return { meta, events, childrenOf, roots, byUuid };
}
function graphToDump(graph) {
  const childrenOf = {};
  for (const [k, v] of graph.childrenOf) childrenOf[k] = v;
  let sidechainCount = 0;
  for (const e of graph.events) if (e.isSidechain) sidechainCount += 1;
  let orphanCount = 0;
  for (const e of graph.events) {
    if (e.parentUuid !== null && !graph.byUuid.has(e.parentUuid)) {
      orphanCount += 1;
    }
  }
  return {
    meta: graph.meta,
    events: graph.events,
    childrenOf,
    roots: graph.roots,
    stats: {
      total_events: graph.events.length,
      root_count: graph.roots.length,
      sidechain_count: sidechainCount,
      orphan_count: orphanCount
    }
  };
}

// src/llm/anthropic.ts
async function createAnthropicClient(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const mod = await import("@anthropic-ai/sdk").catch(() => null);
    if (!mod) return null;
    const Anthropic = mod.default ?? mod;
    const Ctor = Anthropic;
    return new Ctor({ apiKey, timeout: opts.timeoutMs ?? 3e4 });
  } catch {
    return null;
  }
}
async function callSegmentLabel(inp) {
  const maxOut = inp.maxOutputTokens ?? 512;
  const maxRetries = inp.maxRetries ?? 3;
  const sleeper = inp.sleeper ?? defaultSleep;
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await inp.client.messages.create({
        model: inp.model,
        max_tokens: maxOut,
        system: [
          {
            type: "text",
            text: inp.systemPrompt,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          {
            role: "user",
            content: inp.userMessage
          }
        ]
      });
      const text = extractText2(response);
      if (!text) {
        return { ok: false, reason: "empty response content" };
      }
      const parsed = parseLabelJson(text);
      if (!parsed) {
        return {
          ok: false,
          reason: `JSON parse failed for content: ${text.slice(0, 160)}\u2026`
        };
      }
      return {
        ok: true,
        label: parsed,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0
        }
      };
    } catch (err) {
      lastErr = err;
      const status = extractStatus(err);
      if (status === 401 || status === 403) {
        return { ok: false, reason: `auth error (${status})` };
      }
      if (attempt < maxRetries - 1 && shouldRetry(status)) {
        const wait = 500 * 2 ** attempt;
        await sleeper(wait);
        continue;
      }
      break;
    }
  }
  return {
    ok: false,
    reason: errMsg(lastErr)
  };
}
function extractText2(response) {
  if (!Array.isArray(response.content)) return "";
  return response.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").trim();
}
function parseLabelJson(text) {
  let candidate = text.trim();
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) candidate = fenceMatch[1].trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed;
    if (typeof obj.label !== "string" || typeof obj.summary !== "string" || typeof obj.type !== "string" || typeof obj.color !== "string") {
      return null;
    }
    const steps = Array.isArray(obj.next_steps) ? obj.next_steps.filter((s) => typeof s === "string") : [];
    return {
      label: obj.label.slice(0, 60),
      summary: obj.summary,
      type: clampEnum(obj.type, [
        "topic",
        "action",
        "decision",
        "error",
        "dead_end"
      ]),
      color: clampEnum(obj.color, [
        "green",
        "yellow",
        "red"
      ]),
      next_steps: steps
    };
  } catch {
    return null;
  }
}
function clampEnum(val, allowed) {
  return allowed.includes(val) ? val : allowed[0];
}
function extractStatus(err) {
  if (!err || typeof err !== "object") return null;
  const e = err;
  if (typeof e.status === "number") return e.status;
  if (typeof e.response?.status === "number") return e.response.status;
  return null;
}
function shouldRetry(status) {
  if (status === null) return true;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}
function errMsg(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
function defaultSleep(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}

// src/utils/git.ts
import { spawn } from "node:child_process";
var TIMEOUT_MS = 1500;
async function getGitContext(cwd) {
  if (!cwd) return { cwd, available: false, reason: "no cwd" };
  const inside = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return { cwd, available: false, reason: "not a git repo" };
  }
  const [branchR, headR, logR, statusR] = await Promise.all([
    runGit(cwd, ["symbolic-ref", "--short", "HEAD"]),
    runGit(cwd, ["rev-parse", "--short", "HEAD"]),
    runGit(cwd, ["log", "-3", "--pretty=format:%h %s"]),
    runGit(cwd, ["status", "--short"])
  ]);
  return {
    cwd,
    available: true,
    branch: branchR.ok ? branchR.stdout.trim() : "(detached)",
    shortHead: headR.ok ? headR.stdout.trim() : void 0,
    recentCommits: logR.ok ? logR.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0) : void 0,
    status: statusR.ok ? truncate(statusR.stdout.trim(), 800) : void 0
  };
}
function runGit(cwd, args) {
  return new Promise((resolve5) => {
    let settled = false;
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
      }
      resolve5({ ok: false, stdout: "" });
    }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve5({ ok: false, stdout: "" });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve5({ ok: code === 0, stdout });
    });
  });
}
function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "\u2026";
}
function formatGitContextMarkdown(ctx) {
  if (!ctx.available) return null;
  const lines = [];
  lines.push("## Git context (at snapshot time)");
  if (ctx.branch) lines.push(`- branch: \`${ctx.branch}\``);
  if (ctx.shortHead) lines.push(`- HEAD: \`${ctx.shortHead}\``);
  if (ctx.recentCommits && ctx.recentCommits.length > 0) {
    lines.push("- recent commits:");
    for (const c of ctx.recentCommits) lines.push(`  - \`${c}\``);
  }
  if (ctx.status && ctx.status.length > 0) {
    lines.push("- working tree:");
    lines.push("  ```");
    for (const line of ctx.status.split("\n").slice(0, 20)) {
      lines.push(`  ${line}`);
    }
    lines.push("  ```");
  } else if (ctx.status === "") {
    lines.push("- working tree: clean");
  }
  return lines.join("\n");
}

// src/tree/context_snapshot.ts
function buildContinueSnapshot(inp) {
  return {
    mode: "continue",
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderContinueMarkdown(inp),
    related_files: (inp.segment?.dominant_files ?? []).map((path) => ({
      path,
      summary: "(file touched in this segment)"
    })),
    next_steps: inp.llm?.next_steps ?? []
  };
}
function buildForkSnapshot(inp) {
  return {
    mode: "fork",
    session_id: inp.sessionId,
    node_id: inp.nodeId,
    clipboard_markdown: renderForkMarkdown(inp),
    related_files: (inp.segment?.dominant_files ?? []).map((path) => ({
      path,
      summary: "(file state at fork point \u2014 disk may differ)"
    })),
    next_steps: inp.llm?.next_steps ?? []
  };
}
function renderContinueMarkdown(inp) {
  const sections = [];
  sections.push(`# Continuing from: ${inp.label}`);
  sections.push("");
  sections.push(headerLines(inp, "continue"));
  sections.push("");
  const summarySection = sectionContext(inp);
  if (summarySection) {
    sections.push(summarySection);
    sections.push("");
  }
  const files = sectionFiles(inp, "this branch");
  if (files) {
    sections.push(files);
    sections.push("");
  }
  const lastUser = sectionLastUserInstruction(inp);
  if (lastUser) {
    sections.push(lastUser);
    sections.push("");
  }
  const next = sectionNextSteps(inp);
  if (next) {
    sections.push(next);
    sections.push("");
  }
  const git = inp.gitContext ? formatGitContextMarkdown(inp.gitContext) : null;
  if (git) {
    sections.push(git);
    sections.push("");
  }
  sections.push(sectionFullReference(inp));
  sections.push("");
  sections.push("---");
  sections.push("");
  sections.push(
    "Please continue from this point. Prior decisions stand; only the direction forward is open."
  );
  sections.push("");
  return sections.join("\n");
}
function renderForkMarkdown(inp) {
  const sections = [];
  sections.push(`# Forking at: ${inp.label} (discarding future)`);
  sections.push("");
  sections.push(headerLines(inp, "fork"));
  sections.push("");
  const summarySection = sectionContext(
    inp,
    /*forkHeading*/
    true
  );
  if (summarySection) {
    sections.push(summarySection);
    sections.push("");
  }
  const files = sectionFiles(inp, "as of this fork point");
  if (files) {
    sections.push(files);
    sections.push("");
  }
  const openQuestion = sectionOpenQuestion(inp);
  if (openQuestion) {
    sections.push(openQuestion);
    sections.push("");
  }
  sections.push("## What I want you to DO");
  sections.push("- Ignore whatever path the original session took after this.");
  sections.push("- Re-approach the open question fresh.");
  sections.push("- You may suggest different architecture / file layout / tools.");
  sections.push("");
  const git = inp.gitContext ? formatGitContextMarkdown(inp.gitContext) : null;
  if (git) {
    sections.push(git);
    sections.push("");
  }
  sections.push(sectionFullReference(inp));
  sections.push("");
  return sections.join("\n");
}
function headerLines(inp, mode) {
  const range = inp.segment ? `${inp.segment.start_index}\u2013${inp.segment.end_index}` : "whole session";
  const modeLine = mode === "continue" ? "**Mode**: continue (preserving decisions so far)" : "**Mode**: fork (discarding subsequent turns from original session)";
  return [
    `**Source session**: \`${inp.sessionId}\` (events ${range})`,
    modeLine,
    `**Generated**: ${inp.generatedAt}`
  ].join("\n");
}
function sectionContext(inp, fork = false) {
  const heading = fork ? "## State at fork point" : "## Context up to this point";
  if (inp.llm?.summary) {
    const safe = inp.redactor ? inp.redactor.apply(inp.llm.summary) : inp.llm.summary;
    return `${heading}
${safe}`;
  }
  if (inp.segment) {
    const bits = [];
    if (inp.segment.dominant_tools.length > 0) {
      bits.push(`tools used: ${inp.segment.dominant_tools.slice(0, 3).join(", ")}`);
    }
    if (inp.segment.boundary_reasons.length > 0) {
      bits.push(`segment opened by: ${inp.segment.boundary_reasons.join(" + ")}`);
    }
    bits.push(`${inp.segment.event_uuids.length} events in this segment`);
    return `${heading}
${bits.join(". ")}.`;
  }
  return null;
}
function sectionFiles(inp, qualifier) {
  const files = inp.segment?.dominant_files ?? [];
  if (files.length === 0) return null;
  const heading = qualifier === "this branch" ? "## Files touched in this branch" : `## Files ${qualifier}`;
  return `${heading}
${files.map((f) => `- \`${f}\``).join("\n")}`;
}
function sectionLastUserInstruction(inp) {
  const raw = lastUserText(inp.events);
  if (!raw) return null;
  const safe = inp.redactor ? inp.redactor.apply(raw) : raw;
  const quoted = safe.split("\n").map((ln) => `> ${ln}`).join("\n");
  return `## Last user instruction at this point
${quoted}`;
}
function sectionOpenQuestion(inp) {
  const raw = lastUserText(inp.events);
  if (!raw) return null;
  const safe = inp.redactor ? inp.redactor.apply(raw) : raw;
  const quoted = safe.split("\n").map((ln) => `> ${ln}`).join("\n");
  return `## Open question(s) at this moment
${quoted}`;
}
function sectionNextSteps(inp) {
  if (!inp.llm || inp.llm.next_steps.length === 0) return null;
  const steps = inp.redactor ? inp.llm.next_steps.map((s) => inp.redactor.apply(s)) : inp.llm.next_steps;
  return `## Suggested continuation
${steps.map((s) => `- ${s}`).join("\n")}`;
}
function sectionFullReference(inp) {
  const range = inp.segment ? `${inp.segment.start_index}\u2013${inp.segment.end_index}` : "whole session";
  return [
    "## Full session reference",
    `- jsonl: \`${inp.jsonlPath}\``,
    `- event range: ${range}`
  ].join("\n");
}
function lastUserText(events) {
  if (!events || events.length === 0) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== "user") continue;
    const content = e.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
      const joined = parts.join("\n").trim();
      if (joined.length > 0) return joined;
    }
  }
  return null;
}

// src/llm/prompts.ts
var SYSTEM_PROMPT = [
  "You label sections of Claude Code sessions for a mindmap. Produce strict JSON only. No prose.",
  "",
  "Required schema:",
  "{",
  '  "label": "<=60 chars title (user-visible)",',
  '  "summary": "1-2 sentence description",',
  '  "type": "topic|action|decision|error|dead_end",',
  '  "color": "green|yellow|red",',
  '  "next_steps": ["bullet", "bullet"]',
  "}",
  "",
  "Rules:",
  "- label: scannable, concrete (mention files or tools if present)",
  "- dead_end: emit only if ONE OR MORE of:",
  "    (a) three or more consecutive errors without resolution,",
  `    (b) user explicitly says "\uADF8\uB9CC|\uD3EC\uAE30|cancel|nevermind|let's stop",`,
  `    (c) assistant emits "I cannot|unable to|I'm stuck|giving up" AND next user msg switches topic.`,
  '- red color: dead_end OR user expressed frustration ("\uC65C|\uC544\uB2C8|not that|ugh").',
  "- yellow color: exploration, ambiguity, or sidechain-only segments.",
  "- green color: forward progress or clean completion.",
  "- Language: detect the dominant language of the user turns; emit label+summary+next_steps in that language.",
  "- next_steps: 1-3 concrete bullets, imperative mood.",
  "- Respond with ONLY the JSON object. No markdown fences, no explanation."
].join("\n");
function buildSegmentUserMessage(inp) {
  const perEventCap = inp.maxChars ?? 600;
  const lines = [];
  lines.push(`# Segment ${inp.segment.id}`);
  lines.push("");
  lines.push(
    `- events: ${inp.segment.start_index}\u2013${inp.segment.end_index} (${inp.segment.event_uuids.length} total)`
  );
  if (inp.segment.dominant_files.length > 0) {
    lines.push(`- dominant files: ${inp.segment.dominant_files.join(", ")}`);
  }
  if (inp.segment.dominant_tools.length > 0) {
    lines.push(`- dominant tools: ${inp.segment.dominant_tools.join(", ")}`);
  }
  if (inp.segment.boundary_reasons.length > 0) {
    lines.push(`- boundary signals: ${inp.segment.boundary_reasons.join(", ")}`);
  }
  if (inp.segment.is_sidechain_only) {
    lines.push("- sidechain only: true");
  }
  lines.push("");
  lines.push("## Events");
  lines.push("");
  for (const e of inp.events) {
    const header = `### ${e.type}${e.isSidechain ? " (sidechain)" : ""}`;
    lines.push(header);
    const body = renderEventBody(e, perEventCap);
    if (body) lines.push(body);
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Respond with the JSON object described in the system prompt. No other text."
  );
  return lines.join("\n");
}
function renderEventBody(e, cap) {
  switch (e.type) {
    case "user":
    case "assistant": {
      const text = messageText(e).trim();
      return truncate2(text, cap) || "_(empty turn)_";
    }
    case "tool_use": {
      const name = e.tool_use?.name ?? "unknown";
      const input = safeStringify(e.tool_use?.input);
      return `\`${name}\` input: ${truncate2(input, cap)}`;
    }
    case "tool_result": {
      const content = typeof e.tool_result?.content === "string" ? e.tool_result.content : safeStringify(e.tool_result?.content);
      return `tool_result: ${truncate2(content, cap)}`;
    }
    case "attachment": {
      const a = e.attachment;
      const bits = [a.type ?? "attachment"];
      if (a.hookName) bits.push(`hook=${a.hookName}`);
      if (typeof a.exitCode === "number") bits.push(`exit=${a.exitCode}`);
      const snippet2 = a.content ?? a.stdout ?? "";
      const body = truncate2(typeof snippet2 === "string" ? snippet2 : "", cap);
      return `${bits.join(" \xB7 ")} ${body ? `\u2014 ${body}` : ""}`.trim();
    }
    case "system":
      return truncate2(safeStringify(e.payload), cap);
    case "other":
      return `(${e.originalType}) ${truncate2(safeStringify(e.payload), cap)}`;
    default:
      return "";
  }
}
function messageText(e) {
  if (e.type !== "user" && e.type !== "assistant") return "";
  const content = e.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_use") parts.push(`[tool_use: ${b.name ?? "?"}]`);
  }
  return parts.join("\n");
}
function truncate2(s, cap) {
  if (s.length <= cap) return s;
  return s.slice(0, Math.max(0, cap - 1)) + "\u2026";
}
function safeStringify(v) {
  if (v === null || v === void 0) return "";
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// src/llm/labeler.ts
async function labelMindMap(mindmap, graph, segments, opts) {
  const parallel = Math.max(1, opts.parallel ?? 3);
  const maxInput = opts.maxInputTokens ?? 5e4;
  const stats = {
    segments_attempted: 0,
    segments_labeled: 0,
    segments_failed: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0
  };
  const nodesToLabel = [];
  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const collectNodes = (node) => {
    if (node.type === "topic" && node.segment_id) {
      const match = segmentById.get(node.segment_id);
      if (match) {
        const events = graph.events.slice(match.start_index, match.end_index + 1);
        nodesToLabel.push({ node, segment: match, events });
        return;
      }
    }
    for (const c of node.children) collectNodes(c);
  };
  collectNodes(mindmap.root);
  let cursor = 0;
  const workers = [];
  for (let w = 0; w < parallel; w += 1) {
    workers.push(
      (async () => {
        for (; ; ) {
          const idx = cursor;
          cursor += 1;
          if (idx >= nodesToLabel.length) return;
          if (stats.total_input_tokens > maxInput) {
            opts.logger?.warn?.(
              "token budget exhausted, remaining segments keep heuristic labels",
              { limit: maxInput }
            );
            return;
          }
          const entry = nodesToLabel[idx];
          stats.segments_attempted += 1;
          const res = await labelOne(entry, opts);
          applyResult(entry, res, graph, opts.jsonlPath, opts.redactor, stats, opts.logger);
        }
      })()
    );
  }
  await Promise.all(workers);
  return { mindmap, stats };
}
async function labelOne(entry, opts) {
  const rawMessage = buildSegmentUserMessage({
    segment: entry.segment,
    events: entry.events
  });
  const userMessage = opts.redactor ? opts.redactor.apply(rawMessage) : rawMessage;
  return callSegmentLabel({
    client: opts.client,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    model: opts.model
  });
}
function applyResult(entry, res, graph, jsonlPath, redactor, stats, logger) {
  if (!res.ok) {
    stats.segments_failed += 1;
    logger?.warn?.(`LLM label failed for ${entry.segment.id}`, {
      reason: res.reason
    });
    return;
  }
  stats.segments_labeled += 1;
  stats.total_input_tokens += res.usage.inputTokens;
  stats.total_output_tokens += res.usage.outputTokens;
  stats.cache_read_tokens += res.usage.cacheReadTokens;
  stats.cache_creation_tokens += res.usage.cacheCreationTokens;
  const { label } = res;
  const safeLabel = redactor ? redactor.apply(label.label) : label.label;
  const safeSummary = redactor ? redactor.apply(label.summary) : label.summary;
  entry.node.label = safeLabel;
  entry.node.summary = safeSummary;
  entry.node.type = label.type;
  entry.node.color = label.color;
  entry.node.shape = label.type === "decision" ? "diamond" : entry.node.shape;
  if (label.type === "dead_end") {
    entry.node.shape = "circle";
    entry.node.icon = "\u{1F480}";
  }
  const safeNextSteps = redactor ? label.next_steps.map((s) => redactor.apply(s)) : label.next_steps;
  const snapInput = {
    sessionId: graph.meta.sessionId,
    jsonlPath,
    nodeId: entry.node.id,
    label: entry.node.label,
    segment: entry.segment,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    events: entry.events,
    llm: {
      label: safeLabel,
      summary: safeSummary,
      next_steps: safeNextSteps
    },
    redactor
  };
  entry.node.context_snapshot_continue = buildContinueSnapshot(snapInput);
  entry.node.context_snapshot_fork = buildForkSnapshot(snapInput);
}

// src/reader/jsonl.ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// src/types.ts
var UUIDLESS_META_TYPES = /* @__PURE__ */ new Set([
  "permission-mode",
  // line 1 + subsequent permission-mode changes
  "last-prompt",
  "file-history-snapshot",
  "queue-operation"
]);

// src/reader/jsonl.ts
async function readJsonl(path, opts = {}) {
  const { logger, strict = false } = opts;
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let meta = null;
  const events = [];
  let malformedCount = 0;
  let skippedMetaCount = 0;
  let lineNo = 0;
  try {
    for await (const raw of rl) {
      lineNo += 1;
      const line = raw.trim();
      if (line.length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        malformedCount += 1;
        if (strict) {
          throw new Error(
            `jsonl parse error at ${path}:${lineNo} \u2014 ${err.message}`
          );
        }
        logger?.warn(`skipped malformed jsonl line`, { path, lineNo });
        continue;
      }
      if (!isRecord(parsed)) {
        malformedCount += 1;
        logger?.warn(`skipped non-object jsonl line`, { path, lineNo });
        continue;
      }
      const type2 = typeof parsed.type === "string" ? parsed.type : void 0;
      if (meta === null && type2 === "permission-mode") {
        meta = {
          sessionId: String(parsed.sessionId ?? ""),
          permissionMode: String(parsed.permissionMode ?? "default")
        };
        continue;
      }
      if (type2 && UUIDLESS_META_TYPES.has(type2)) {
        skippedMetaCount += 1;
        logger?.trace(`skipped uuidless meta line`, { lineNo, type: type2 });
        continue;
      }
      const ev = coerceRawEvent(parsed, lineNo, logger);
      if (ev) events.push(ev);
      else malformedCount += 1;
    }
  } finally {
    rl.close();
    stream.close();
  }
  if (!meta) {
    const first = events[0];
    meta = {
      sessionId: first?.sessionId ?? "",
      permissionMode: "default"
    };
    logger?.warn(`no permission-mode meta line; synthesized from first event`);
  }
  return { meta, events, malformedCount, skippedMetaCount };
}
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function coerceRawEvent(obj, lineNo, logger) {
  const uuid = typeof obj.uuid === "string" ? obj.uuid : void 0;
  if (!uuid) {
    logger?.debug(`event missing uuid, skipping`, {
      lineNo,
      type: obj.type
    });
    return null;
  }
  const type2 = typeof obj.type === "string" ? obj.type : void 0;
  if (!type2) {
    logger?.debug(`event missing type, skipping`, { lineNo, uuid });
    return null;
  }
  const envelope = {
    uuid,
    parentUuid: typeof obj.parentUuid === "string" || obj.parentUuid === null ? obj.parentUuid : null,
    isSidechain: Boolean(obj.isSidechain),
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : "",
    cwd: typeof obj.cwd === "string" ? obj.cwd : "",
    gitBranch: typeof obj.gitBranch === "string" ? obj.gitBranch : "",
    version: typeof obj.version === "string" ? obj.version : "",
    entrypoint: typeof obj.entrypoint === "string" ? obj.entrypoint : "",
    userType: typeof obj.userType === "string" ? obj.userType : ""
  };
  switch (type2) {
    case "attachment":
      return {
        ...envelope,
        type: "attachment",
        attachment: isRecord(obj.attachment) ? obj.attachment : { type: "unknown" }
      };
    case "user":
    case "assistant":
      return {
        ...envelope,
        type: type2,
        message: isRecord(obj.message) ? obj.message : { role: type2, content: [] }
      };
    case "tool_use":
      return {
        ...envelope,
        type: "tool_use",
        tool_use: isRecord(obj.tool_use) ? obj.tool_use : { id: "", name: "", input: null }
      };
    case "tool_result":
      return {
        ...envelope,
        type: "tool_result",
        tool_result: isRecord(obj.tool_result) ? obj.tool_result : { tool_use_id: "", content: "" }
      };
    case "system":
      return {
        ...envelope,
        type: "system",
        payload: obj
      };
    default:
      return {
        ...envelope,
        type: "other",
        originalType: type2,
        payload: obj
      };
  }
}

// src/tree/builder.ts
function buildMindMap(graph, segments, opts) {
  const generatedAt = opts.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const sessionId = graph.meta.sessionId;
  const main2 = [];
  const sidechain = [];
  for (const s of segments) {
    (s.is_sidechain_only ? sidechain : main2).push(s);
  }
  const sessionStartMs = (() => {
    for (const e of graph.events) {
      const ts = Date.parse(e.timestamp);
      if (Number.isFinite(ts)) return ts;
    }
    return NaN;
  })();
  const offsetFor = (iso) => {
    if (!Number.isFinite(sessionStartMs)) return void 0;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return void 0;
    return Math.max(0, t - sessionStartMs);
  };
  const idAllocator = new IdAllocator();
  const rootId = idAllocator.next();
  const rootLabel = deriveSessionTitle(
    graph.events,
    sessionId,
    opts.sessionTitle,
    opts.redactor
  );
  const firstUserEvent = graph.events.find((e) => e.type === "user");
  const rootInstructionEvents = firstUserEvent ? [firstUserEvent] : [];
  const rootSnapInput = {
    sessionId,
    jsonlPath: opts.jsonlPath,
    nodeId: rootId,
    label: rootLabel,
    segment: null,
    generatedAt,
    events: rootInstructionEvents,
    redactor: opts.redactor
  };
  const rootNode = {
    id: rootId,
    type: "root",
    label: rootLabel,
    summary: `Session ${shortId(sessionId)} \u2014 ${graph.events.length} events, ${segments.length} segments`,
    index_range: [0, Math.max(0, graph.events.length - 1)],
    event_uuids: graph.events.map((e) => e.uuid),
    files_touched: uniq(segments.flatMap((s) => s.dominant_files)),
    tools_used: uniq(segments.flatMap((s) => s.dominant_tools)),
    is_sidechain: false,
    children: [],
    context_snapshot_continue: buildContinueSnapshot(rootSnapInput),
    context_snapshot_fork: buildForkSnapshot(rootSnapInput),
    color: "green",
    shape: "rect",
    time_offset_ms: 0
  };
  const phases = groupSegmentsIntoPhases(main2, graph.events);
  for (const phase of phases) {
    const phaseEvents = graph.events.slice(
      phase.headSegment.start_index,
      phase.headSegment.end_index + 1
    );
    const phaseNode = buildSegmentNode(phase.headSegment, {
      idAllocator,
      sessionId,
      jsonlPath: opts.jsonlPath,
      generatedAt,
      parentIsSidechain: false,
      events: phaseEvents,
      redactor: opts.redactor,
      timeOffsetMs: offsetFor(phase.headSegment.time_range[0]),
      promotePhaseIcon: true
    });
    for (const childSeg of phase.children) {
      phaseNode.children.push(
        buildSegmentNode(childSeg, {
          idAllocator,
          sessionId,
          jsonlPath: opts.jsonlPath,
          generatedAt,
          parentIsSidechain: false,
          events: graph.events.slice(childSeg.start_index, childSeg.end_index + 1),
          redactor: opts.redactor,
          timeOffsetMs: offsetFor(childSeg.time_range[0])
        })
      );
    }
    phaseNode.phase_meta = computePhaseMeta(phase);
    rootNode.children.push(phaseNode);
  }
  if (sidechain.length > 0) {
    const bucketId = idAllocator.next();
    const bucketLabel = "\u{1F500} Sidechains";
    const bucketNode = {
      id: bucketId,
      type: "topic",
      label: bucketLabel,
      summary: `${sidechain.length} sidechain segment${sidechain.length === 1 ? "" : "s"} spawned by subagents`,
      index_range: coverageRange(sidechain),
      event_uuids: sidechain.flatMap((s) => s.event_uuids),
      files_touched: uniq(sidechain.flatMap((s) => s.dominant_files)),
      tools_used: uniq(sidechain.flatMap((s) => s.dominant_tools)),
      is_sidechain: true,
      children: [],
      context_snapshot_continue: buildContinueSnapshot({
        sessionId,
        jsonlPath: opts.jsonlPath,
        nodeId: bucketId,
        label: bucketLabel,
        segment: null,
        generatedAt
      }),
      context_snapshot_fork: buildForkSnapshot({
        sessionId,
        jsonlPath: opts.jsonlPath,
        nodeId: bucketId,
        label: bucketLabel,
        segment: null,
        generatedAt
      }),
      color: "yellow",
      shape: "rect"
    };
    for (const seg of sidechain) {
      bucketNode.children.push(
        buildSegmentNode(seg, {
          idAllocator,
          sessionId,
          jsonlPath: opts.jsonlPath,
          generatedAt,
          parentIsSidechain: true,
          events: graph.events.slice(seg.start_index, seg.end_index + 1),
          redactor: opts.redactor,
          timeOffsetMs: offsetFor(seg.time_range[0])
        })
      );
    }
    rootNode.children.push(bucketNode);
  }
  const durationMinutes = computeDurationMinutes(graph.events);
  const sidechainCount = graph.events.filter((e) => e.isSidechain).length;
  const totalToolCalls = countToolCalls(graph.events);
  const totalTurns = graph.events.filter(
    (e) => e.type === "user" || e.type === "assistant"
  ).length;
  return {
    session_id: sessionId,
    project_path: graph.events[0]?.cwd ?? "",
    generated_at: generatedAt,
    spec_version: opts.specVersion,
    root: rootNode,
    stats: {
      total_events: graph.events.length,
      total_turns: totalTurns,
      total_nodes: countNodes(rootNode),
      total_tool_calls: totalToolCalls,
      total_files_touched: uniq(segments.flatMap((s) => s.dominant_files)).length,
      duration_minutes: durationMinutes,
      sidechain_count: sidechainCount
    }
  };
}
function groupSegmentsIntoPhases(segments, events) {
  if (segments.length === 0) return [];
  const phases = [];
  let current = null;
  let pending = [];
  for (const seg of segments) {
    const segEvents = events.slice(seg.start_index, seg.end_index + 1);
    const userText = firstUserMessageText(segEvents);
    const isSignificant = !!userText && !looksLikeSystemNoise(userText) && userText.trim().length >= 10;
    if (isSignificant) {
      current = { headSegment: seg, children: pending };
      pending = [];
      phases.push(current);
    } else if (current) {
      current.children.push(seg);
    } else {
      pending.push(seg);
    }
  }
  if (pending.length > 0 && !current) {
    phases.push({ headSegment: pending[0], children: pending.slice(1) });
  }
  return phases;
}
function computePhaseMeta(phase) {
  const allSegments = [phase.headSegment, ...phase.children];
  const fileSet = /* @__PURE__ */ new Set();
  for (const s of allSegments) for (const f of s.dominant_files) fileSet.add(f);
  const actionCount = phase.children.length;
  const startMs = Date.parse(phase.headSegment.time_range[0]);
  const lastSeg = allSegments[allSegments.length - 1];
  const endMs = Date.parse(lastSeg.time_range[1] || lastSeg.time_range[0]);
  let durationStr = "";
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const min = Math.round((endMs - startMs) / 6e4);
    durationStr = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}min`;
  }
  const parts = [];
  parts.push(`${actionCount} action${actionCount === 1 ? "" : "s"}`);
  if (fileSet.size > 0) parts.push(`${fileSet.size} file${fileSet.size === 1 ? "" : "s"}`);
  if (durationStr) parts.push(durationStr);
  return parts.join(" \xB7 ");
}
function buildSegmentNode(seg, ctx) {
  const id = ctx.idAllocator.next();
  const label = deriveSegmentLabel(seg, ctx.events, ctx.redactor);
  const type2 = "topic";
  const icon = ctx.promotePhaseIcon ? "\u{1F4CC}" : void 0;
  const snapshotInput = {
    sessionId: ctx.sessionId,
    jsonlPath: ctx.jsonlPath,
    nodeId: id,
    label,
    segment: seg,
    generatedAt: ctx.generatedAt,
    events: ctx.events,
    redactor: ctx.redactor
  };
  const node = {
    id,
    type: type2,
    label,
    summary: deriveSegmentSummary(seg),
    index_range: [seg.start_index, seg.end_index],
    event_uuids: seg.event_uuids,
    files_touched: seg.dominant_files,
    tools_used: seg.dominant_tools,
    is_sidechain: seg.is_sidechain_only || ctx.parentIsSidechain,
    children: [],
    context_snapshot_continue: buildContinueSnapshot(
      snapshotInput
    ),
    context_snapshot_fork: buildForkSnapshot(snapshotInput),
    color: seg.is_sidechain_only ? "yellow" : "green",
    shape: "rect",
    segment_id: seg.id,
    time_offset_ms: ctx.timeOffsetMs,
    icon
  };
  return node;
}
function deriveSegmentLabel(seg, events, redactor) {
  const userText = firstUserMessageText(events);
  if (userText && !looksLikeSystemNoise(userText)) {
    const cleaned = shortenPaths(userText.replace(/\s+/g, " ").trim());
    const safe = redactor ? redactor.apply(cleaned) : cleaned;
    return `"${truncate3(safe, 56)}"`;
  }
  const topFile = seg.dominant_files[0];
  const topTool = seg.dominant_tools[0];
  const eventCount = seg.event_uuids.length;
  if (topFile && topTool) return truncate3(`${basename(topFile)} (${topTool})`, 60);
  if (topFile) return truncate3(basename(topFile), 60);
  if (topTool) return truncate3(topTool, 60);
  return `${eventCount} events`;
}
function looksLikeSystemNoise(text) {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("<") || t.startsWith("[SYSTEM")) return true;
  if (t.startsWith("Stop hook ")) return true;
  if (t.startsWith("Base directory for this skill:")) return true;
  if (/^[❯>$#] /.test(t)) return true;
  return false;
}
function shortenPaths(text) {
  return text.replace(
    /(\/(?:Users|home|root|tmp|var)\/[^\s,;:`'"]*)/g,
    (full) => {
      const last = full.lastIndexOf("/");
      return last >= 0 && last < full.length - 1 ? full.slice(last + 1) : full;
    }
  );
}
function deriveSegmentSummary(seg) {
  const reasons = seg.boundary_reasons.length ? ` (boundary: ${seg.boundary_reasons.join("+")})` : "";
  const files = seg.dominant_files.slice(0, 3).join(", ");
  const tools = seg.dominant_tools.slice(0, 3).join(", ");
  return `events ${seg.start_index}\u2013${seg.end_index}${reasons}${files ? ` \xB7 files: ${files}` : ""}${tools ? ` \xB7 tools: ${tools}` : ""}`;
}
function deriveSessionTitle(events, sessionId, override, redactor) {
  if (override) return truncate3(override, 60);
  const firstSignificant = firstSignificantUserText(events);
  const firstUserText = firstSignificant ?? firstUserMessageText(events);
  if (firstUserText) {
    const cleaned = shortenPaths(firstUserText.replace(/\s+/g, " "));
    const safe = redactor ? redactor.apply(cleaned) : cleaned;
    return truncate3(safe, 60);
  }
  return `Session ${shortId(sessionId)}`;
}
function firstSignificantUserText(events) {
  for (const e of events) {
    if (e.type !== "user") continue;
    const content = e.message?.content;
    let text = null;
    if (typeof content === "string" && content.trim().length > 0) {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const b = block;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          text = b.text;
          break;
        }
      }
    }
    if (text && !looksLikeSystemNoise(text) && text.trim().length >= 10) {
      return text;
    }
  }
  return null;
}
function firstUserMessageText(events) {
  for (const e of events) {
    if (e.type !== "user") continue;
    const content = e.message?.content;
    if (typeof content === "string" && content.trim().length > 0) return content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text") {
        const text = block.text;
        if (typeof text === "string" && text.trim().length > 0) return text;
      }
    }
  }
  return null;
}
function computeDurationMinutes(events) {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.round((latest - earliest) / 6e4);
}
function countToolCalls(events) {
  let n = 0;
  for (const e of events) {
    if (e.type === "tool_use") n += 1;
    else if (e.type === "assistant") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && block.type === "tool_use") {
            n += 1;
          }
        }
      }
    }
  }
  return n;
}
function countNodes(node) {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}
function coverageRange(segs) {
  if (segs.length === 0) return [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segs) {
    if (s.start_index < lo) lo = s.start_index;
    if (s.end_index > hi) hi = s.end_index;
  }
  return [lo, hi];
}
function uniq(arr) {
  return Array.from(new Set(arr));
}
function basename(p) {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}
function truncate3(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "\u2026";
}
function shortId(id) {
  return id.slice(0, 8);
}
var IdAllocator = class {
  counter = 0;
  next() {
    this.counter += 1;
    return `n_${String(this.counter).padStart(3, "0")}`;
  }
};

// src/utils/redact.ts
var DEFAULT_PATTERNS = [
  {
    name: "anthropic_api_key",
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: "sk-ant-***REDACTED***"
  },
  {
    name: "openai_api_key",
    regex: /sk-[A-Za-z0-9]{32,}/g,
    replacement: "sk-***REDACTED***"
  },
  {
    name: "github_pat",
    regex: /gh[pous]_[A-Za-z0-9]{30,}/g,
    replacement: "gh*_***REDACTED***"
  },
  {
    name: "slack_token",
    regex: /xox[bpoar]-[A-Za-z0-9-]{10,}/g,
    replacement: "xox*-***REDACTED***"
  },
  {
    name: "bearer_token",
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
    replacement: "Bearer ***REDACTED***"
  },
  {
    name: "aws_access_key_id",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "AKIA***REDACTED***"
  },
  {
    name: "aws_temp_key",
    regex: /\bASIA[0-9A-Z]{16}\b/g,
    replacement: "ASIA***REDACTED***"
  },
  {
    name: "gcp_api_key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "AIza***REDACTED***"
  },
  {
    name: "gcp_oauth_token",
    regex: /\bya29\.[0-9A-Za-z_-]{20,}/g,
    replacement: "ya29.***REDACTED***"
  },
  {
    // GitHub fine-grained PAT: `github_pat_<22 alnum>_<59 alnum_>` (≥82 total)
    name: "github_pat_finegrained",
    regex: /\bgithub_pat_[A-Za-z0-9_]{82,}/g,
    replacement: "github_pat_***REDACTED***"
  },
  {
    // OpenAI project / service-account / admin keys (added 2024)
    name: "openai_project_key",
    regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
    replacement: "sk-***REDACTED***"
  },
  {
    name: "stripe_secret_key",
    regex: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}/g,
    replacement: "sk_***REDACTED***"
  },
  {
    name: "huggingface_token",
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
    replacement: "hf_***REDACTED***"
  },
  {
    name: "private_key_block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "-----REDACTED PRIVATE KEY-----"
  },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "eyJ***REDACTED.JWT***"
  }
];
var STRICT_EXTRA = [
  {
    name: "email",
    regex: /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[EMAIL]"
  },
  // IMPORTANT: ssn_us and rrn_ko are narrower patterns — they must run before
  // the generic phone regex, or the phone regex swallows their digit groups.
  {
    name: "ssn_us",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN]"
  },
  {
    name: "rrn_ko",
    regex: /\b\d{6}-[1-4]\d{6}\b/g,
    replacement: "[RRN]"
  },
  {
    // International E.164 or local 10-15 digit with separators
    name: "phone",
    regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
    replacement: "[PHONE]"
  }
];
function defaultRedactor(opts = {}) {
  const patterns = [
    ...DEFAULT_PATTERNS,
    ...opts.strict ? STRICT_EXTRA : [],
    ...opts.extraPatterns ?? []
  ];
  return {
    patterns,
    apply(text) {
      if (!text) return text;
      let out = text;
      for (const p of patterns) out = out.replace(p.regex, p.replacement);
      out = redactCreditCards(out);
      return out;
    },
    applyWithStats(text) {
      const hits = {};
      if (!text) return { text, hits };
      let out = text;
      for (const p of patterns) {
        const matches = out.match(p.regex);
        if (matches && matches.length > 0) hits[p.name] = matches.length;
        out = out.replace(p.regex, p.replacement);
      }
      const cardResult = redactCreditCardsWithStats(out);
      if (cardResult.hits > 0) hits.credit_card = cardResult.hits;
      return { text: cardResult.text, hits };
    }
  };
}
function redactDeep(value, redactor) {
  if (value == null) return value;
  if (typeof value === "string") return redactor.apply(value);
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, redactor));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v, redactor);
    }
    return out;
  }
  return value;
}
var CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
function redactCreditCards(text) {
  return redactCreditCardsWithStats(text).text;
}
function redactCreditCardsWithStats(text) {
  let hits = 0;
  const result = text.replace(CARD_RE, (match) => {
    const digits = match.replace(/[^0-9]/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    hits += 1;
    return "[CARD]";
  });
  return { text: result, hits };
}
function luhnValid(digits) {
  let sum = 0;
  let flip = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (flip) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    flip = !flip;
  }
  return sum % 10 === 0;
}

// src/cli/pipeline.ts
var SPEC_VERSION = "v0.3";
async function runPipeline(deps) {
  const { match, opts, config, logger, quiet = false } = deps;
  const progress = (msg) => {
    if (!quiet) process.stderr.write(msg);
  };
  const redactor = buildRedactor(opts, config, logger);
  const sidechainHandling = pickSidechainMode(opts, config);
  const cacheHash = await computeInputHash({
    jsonlPath: match.jsonlPath,
    configJson: JSON.stringify({
      llm: opts.llm !== false,
      model: opts.model,
      maxTok: opts.maxLlmTokens,
      redactStrict: Boolean(opts.redactStrict),
      sidechainHandling
    }),
    specVersion: SPEC_VERSION
  });
  progress("[1/5] Parsing JSONL...       ");
  const { meta, events, malformedCount, skippedMetaCount } = await readJsonl(
    match.jsonlPath,
    { logger }
  );
  progress(`\u2714 ${events.length} events`);
  if (malformedCount > 0) progress(`  (${malformedCount} malformed)`);
  if (skippedMetaCount > 0) progress(`  (${skippedMetaCount} meta lines)`);
  progress("\n");
  if (events.length === 0) {
    const emptyMindmap = {
      session_id: meta.sessionId,
      project_path: "",
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      spec_version: SPEC_VERSION,
      root: {
        id: "n_001",
        type: "root",
        label: "(empty session)",
        summary: "No events found in this jsonl.",
        index_range: [0, 0],
        event_uuids: [],
        files_touched: [],
        tools_used: [],
        is_sidechain: false,
        children: [],
        context_snapshot_continue: emptySnapshot("continue", meta.sessionId),
        context_snapshot_fork: emptySnapshot("fork", meta.sessionId)
      },
      stats: {
        total_events: 0,
        total_turns: 0,
        total_nodes: 1,
        total_tool_calls: 0,
        total_files_touched: 0,
        duration_minutes: 0,
        sidechain_count: 0
      }
    };
    return {
      graph: { meta, events: [], childrenOf: /* @__PURE__ */ new Map(), roots: [], byUuid: /* @__PURE__ */ new Map() },
      segments: [],
      mindmap: emptyMindmap,
      redactor,
      cacheHash,
      isEmpty: true
    };
  }
  progress("[2/5] Building graph...      ");
  const graph = buildGraph(meta, events, { logger });
  const sidechainCount = graph.events.reduce(
    (acc, e) => e.isSidechain ? acc + 1 : acc,
    0
  );
  progress(`\u2714 ${pl(graph.roots.length, "root")}, ${pl(sidechainCount, "sidechain")}
`);
  progress("[3/5] Detecting segments...  ");
  const segments = detectSegments(graph.events, { sidechainHandling });
  progress(`\u2714 ${pl(segments.length, "segment")}
`);
  progress("[4/5] Building mindmap...    ");
  const mindmap = buildMindMap(graph, segments, {
    jsonlPath: match.jsonlPath,
    specVersion: SPEC_VERSION,
    redactor
  });
  progress(
    `\u2714 ${pl(mindmap.stats.total_nodes, "node")} across depth ${treeDepth(mindmap)}
`
  );
  const llmEnabled = opts.llm !== false && config.llm.enabled;
  if (!llmEnabled) {
    logger.debug("LLM labeling disabled (flag or config).");
  } else {
    const client = await createAnthropicClient({});
    if (!client) {
      logger.warn(
        "LLM labeling unavailable (no ANTHROPIC_API_KEY or SDK missing) \u2014 heuristic labels retained."
      );
    } else {
      progress("[LLM ] Labeling segments...  ");
      const maxTok = parseInt(opts.maxLlmTokens ?? String(config.llm.max_input_tokens), 10) || config.llm.max_input_tokens;
      const model = opts.model ?? config.llm.model;
      const { stats } = await labelMindMap(mindmap, graph, segments, {
        client,
        model,
        maxInputTokens: maxTok,
        parallel: 3,
        logger,
        redactor,
        jsonlPath: match.jsonlPath
      });
      const cacheRatio = stats.total_input_tokens > 0 ? Math.round(stats.cache_read_tokens / stats.total_input_tokens * 100) : 0;
      progress(
        `\u2714 ${stats.segments_labeled}/${stats.segments_attempted} labeled  (cached ${cacheRatio}%, ${stats.total_input_tokens} in / ${stats.total_output_tokens} out)
`
      );
      if (stats.segments_failed > 0) {
        logger.warn(`${stats.segments_failed} segment(s) kept heuristic label`);
      }
    }
  }
  if (opts.verbose || opts.trace) {
    await Promise.all([
      writeJsonCache(cacheHash, "segments.json", {
        session_id: graph.meta.sessionId,
        count: segments.length,
        segments: redactDeep(segments, redactor)
      }).catch(
        (err) => logger.warn("aux cache write failed (segments)", { error: String(err) })
      ),
      writeJsonCache(cacheHash, "tree.json", mindmap).catch(
        (err) => logger.warn("aux cache write failed (tree)", { error: String(err) })
      ),
      writeJsonCache(cacheHash, "graph.json", redactDeep(graphToDump(graph), redactor)).catch(
        (err) => logger.warn("aux cache write failed (graph)", { error: String(err) })
      )
    ]);
    logger.debug("mirrored intermediate artifacts to cache", { cacheHash });
  }
  return { graph, segments, mindmap, redactor, cacheHash, isEmpty: false };
}
function buildRedactor(opts, config, logger) {
  return defaultRedactor({
    strict: Boolean(opts.redactStrict) || config.redaction.strict,
    extraPatterns: (config.redaction.extra_patterns ?? []).map((pattern, i) => {
      try {
        return {
          name: `extra_${i}`,
          regex: new RegExp(pattern, "g"),
          replacement: "[REDACTED]"
        };
      } catch {
        logger.warn("invalid redaction.extra_patterns entry", { pattern });
        return null;
      }
    }).filter((x) => x !== null)
  });
}
function pickSidechainMode(opts, config) {
  if (opts.dropSidechains) return "drop";
  if (opts.flattenSidechains) return "flatten";
  if (opts.includeSidechains) return "include";
  return config.analyzer.sidechain_handling;
}
function pl(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function treeDepth(mindmap) {
  const walk = (n, d) => {
    if (n.children.length === 0) return d;
    let best = d;
    for (const c of n.children) {
      const cd = walk(c, d + 1);
      if (cd > best) best = cd;
    }
    return best;
  };
  return walk(mindmap.root, 0);
}
function emptySnapshot(mode, sessionId) {
  return {
    mode,
    session_id: sessionId,
    node_id: "n_001",
    clipboard_markdown: `# ${mode === "continue" ? "Continuing" : "Forking"} from empty session

_(no events were parsed.)_
`,
    related_files: [],
    next_steps: []
  };
}

// src/cli/modes.ts
import { mkdir as mkdir3, writeFile as writeFile2 } from "node:fs/promises";
import { resolve as resolve2 } from "node:path";

// src/render/text.ts
var DEFAULT_MAX_WIDTH = 90;
function detectTerminalWidth() {
  const cols = process.stdout?.columns;
  if (typeof cols !== "number" || !Number.isFinite(cols) || cols <= 0) {
    return DEFAULT_MAX_WIDTH;
  }
  return Math.max(60, Math.min(cols, 200));
}
function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 4352 && cp <= 4447) w += 2;
    else if (cp >= 11904 && cp <= 12350) w += 2;
    else if (cp >= 12353 && cp <= 13311) w += 2;
    else if (cp >= 13312 && cp <= 19903) w += 2;
    else if (cp >= 19968 && cp <= 40959) w += 2;
    else if (cp >= 40960 && cp <= 42191) w += 2;
    else if (cp >= 44032 && cp <= 55203) w += 2;
    else if (cp >= 63744 && cp <= 64255) w += 2;
    else if (cp >= 65072 && cp <= 65103) w += 2;
    else if (cp >= 65280 && cp <= 65376) w += 2;
    else if (cp >= 65504 && cp <= 65510) w += 2;
    else if (cp === 8205) w += 0;
    else if (cp >= 65024 && cp <= 65039) w += 0;
    else if (cp >= 917760 && cp <= 917999) w += 0;
    else if (cp >= 65536) w += 2;
    else w += 1;
  }
  return w;
}
var ANSI = {
  reset: "\x1B[0m",
  dim: "\x1B[2m",
  cyan: "\x1B[36m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m",
  brightBlack: "\x1B[90m"
};
var wrap = (on, code, s) => on ? `${code}${s}${ANSI.reset}` : s;
function renderTextTree(mindmap, opts = {}) {
  const maxWidth = opts.maxWidth ?? detectTerminalWidth();
  const showRange = opts.showRange !== false;
  const filterKw = opts.filter?.toLowerCase().trim();
  const groupConsecutive = opts.groupConsecutive ?? true;
  const color = opts.color === true;
  const numbered = [];
  const allRows = [];
  walk(mindmap.root, 0, [], true);
  const padWidth = String(numbered.length || 1).length;
  const numberToId = /* @__PURE__ */ new Map();
  const idToNumber = /* @__PURE__ */ new Map();
  for (const n of numbered) {
    numberToId.set(n.number, n.id);
    idToNumber.set(n.id, n.number);
  }
  let visibleRows = allRows;
  if (filterKw) {
    visibleRows = allRows.filter((r) => {
      const haystack = `${r.label} ${r.time} ${r.range} ${r.id}`.toLowerCase();
      return haystack.includes(filterKw);
    });
  }
  if (groupConsecutive) {
    visibleRows = collapseRuns(visibleRows);
  }
  const labelCol = Math.min(maxWidth, 70);
  let maxLabelWidth = 0;
  for (const r of visibleRows) {
    const w = displayWidth(r.label);
    if (w > maxLabelWidth) maxLabelWidth = w;
  }
  const targetCol = Math.min(maxLabelWidth, labelCol);
  const lines = [];
  const stats = mindmap.stats;
  const headerParts = [
    `agent-tree`,
    `session ${shortId2(mindmap.session_id)}`,
    `${stats.total_events} events`,
    `${stats.total_turns} turns`,
    `${stats.total_nodes} nodes`
  ];
  if (stats.duration_minutes > 0) headerParts.push(`${stats.duration_minutes} min`);
  if (stats.sidechain_count > 0)
    headerParts.push(`${stats.sidechain_count} sidechain`);
  lines.push(wrap(color, ANSI.dim, headerParts.join(" \xB7 ")));
  if (filterKw) {
    lines.push(
      wrap(
        color,
        ANSI.dim,
        `(filter: "${filterKw}" \u2014 ${visibleRows.length}/${allRows.length} rows)`
      )
    );
  }
  lines.push("");
  for (const row of visibleRows) {
    const numStr = wrap(
      color,
      ANSI.brightBlack,
      String(row.number).padStart(padWidth, " ")
    );
    const prefix = wrap(color, ANSI.brightBlack, row.prefix);
    const pickMark = pickMarker(row);
    const labelColored = colorizeLabel(row, color);
    const rawWidth = displayWidth(pickMark + row.label);
    const padding = rawWidth < targetCol ? " ".repeat(targetCol - rawWidth) : " ";
    const time = wrap(color, ANSI.brightBlack, row.time);
    const range = wrap(color, ANSI.brightBlack, row.range);
    const trailing = [time, range].filter((s) => s.length > 0).join("  ");
    lines.push(`${numStr}. ${prefix}${pickMark}${labelColored}${padding}${trailing}`);
  }
  return {
    text: lines.join("\n"),
    nodes: numbered,
    numberToId,
    idToNumber
  };
  function walk(node, depth, ancestorLastFlags, isLast) {
    if (typeof opts.maxDepth === "number" && depth > opts.maxDepth) return;
    const number = numbered.length + 1;
    numbered.push({ number, id: node.id, depth });
    let prefix = "";
    for (const ancestorLast of ancestorLastFlags) {
      prefix += ancestorLast ? "   " : "\u2502  ";
    }
    if (depth > 0) prefix += isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
    const sidechainTag = node.is_sidechain && node.type !== "root" ? "[sidechain] " : "";
    const meta = node.phase_meta ? `  (${node.phase_meta})` : "";
    const label = `${sidechainTag}${node.label}${meta}`;
    const time = typeof node.time_offset_ms === "number" ? formatRelative(node.time_offset_ms) : "";
    const range = showRange ? `events ${node.index_range[0]}\u2013${node.index_range[1]}` : "";
    const isUserText = label.startsWith('"');
    const fileToolKey = isUserText ? null : extractFileKey(label);
    const modes = opts.picks?.get(node.id);
    allRows.push({
      number,
      id: node.id,
      prefix,
      label,
      time,
      range,
      isUserText,
      fileToolKey,
      color: node.color,
      pickedContinue: !!modes?.has("continue"),
      pickedFork: !!modes?.has("fork")
    });
    const nextAncestors = depth === 0 ? [] : [...ancestorLastFlags, isLast];
    node.children.forEach((c, i) => {
      walk(c, depth + 1, nextAncestors, i === node.children.length - 1);
    });
  }
}
function collapseRuns(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const head = rows[i];
    if (!head.fileToolKey) {
      out.push(head);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && rows[j].fileToolKey === head.fileToolKey && rows[j].prefix === head.prefix) {
      j += 1;
    }
    const runLen = j - i;
    if (runLen >= 3) {
      const last = rows[j - 1];
      const collapsed = {
        ...head,
        label: `${head.fileToolKey} \xD7${runLen}`,
        time: head.time && last.time ? `${head.time} \u2192 ${last.time}` : head.time || last.time,
        range: head.range && last.range ? `events ${head.range.replace(/^events\s/, "").split("\u2013")[0]}\u2013${last.range.replace(/^events\s/, "").split("\u2013")[1]} (#${head.number}-#${last.number})` : head.range
      };
      out.push(collapsed);
    } else {
      for (let k = i; k < j; k += 1) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}
function extractFileKey(label) {
  const m = label.match(/^([\w.\-/]+\.[A-Za-z0-9]+)\s+\(/);
  return m ? m[1] : null;
}
function pickMarker(row) {
  return row.pickedContinue || row.pickedFork ? "\u2B50 " : "";
}
function colorizeLabel(row, color) {
  if (!color) return row.label;
  let base;
  if (row.isUserText) base = wrap(true, ANSI.cyan, row.label);
  else if (row.color === "red") base = wrap(true, ANSI.red, row.label);
  else if (row.color === "yellow") base = wrap(true, ANSI.yellow, row.label);
  else if (row.color === "green") base = wrap(true, ANSI.green, row.label);
  else base = wrap(true, ANSI.dim, row.label);
  if (row.pickedContinue || row.pickedFork) {
    return `\x1B[1m${base}\x1B[22m`;
  }
  return base;
}
function shortId2(id) {
  return id.slice(0, 8);
}
function formatRelative(deltaMs) {
  if (deltaMs < 1e3) return "T0";
  const totalSec = Math.floor(deltaMs / 1e3);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  if (h > 0) return `T+${h}h ${m}m`;
  if (m > 0) return `T+${m}m`;
  return `T+${s}s`;
}
function parseSelection(input) {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, mode: "continue", reason: "empty input" };
  if (/^q(uit)?$/i.test(trimmed)) {
    return { ok: false, mode: "continue", reason: "user quit" };
  }
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0];
  const tail = tokens.slice(1).join(" ").toLowerCase();
  let mode = "continue";
  if (tail === "fork" || tail === "f") mode = "fork";
  else if (tail === "continue" || tail === "c" || tail === "") mode = "continue";
  else
    return {
      ok: false,
      mode,
      reason: `unknown mode "${tail}" \u2014 expected continue|fork (or omit)`
    };
  return { ok: true, numberOrId: head, mode };
}
function lookupSnapshot(mindmap, numberOrId, result) {
  const asNumber = Number(numberOrId);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const id = result.numberToId.get(asNumber);
    if (id) return findNodeById(mindmap.root, id);
  }
  const idCandidate = numberOrId.startsWith("n_") ? numberOrId : `n_${String(numberOrId).padStart(3, "0")}`;
  return findNodeById(mindmap.root, idCandidate);
}
function findNodeById(node, id) {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findNodeById(c, id);
    if (hit) return hit;
  }
  return null;
}

// src/cli/tui.ts
import { createInterface as createInterface2 } from "node:readline/promises";
async function runTui(mindmap, opts = {}) {
  const out = opts.output ?? process.stderr;
  const inn = opts.input ?? process.stdin;
  const tree = renderTextTree(mindmap);
  out.write(tree.text + "\n\n");
  out.write(
    `Pick a number to copy that node's context.
  \u2022 "N"        \u2192 continue mode (preserve decisions, change direction)
  \u2022 "N fork"   \u2192 fork mode (discard subsequent turns)
  \u2022 "q"        \u2192 quit

`
  );
  const rl = createInterface2({ input: inn, output: out });
  try {
    for (; ; ) {
      const ans = await rl.question("> ");
      const parsed = parseSelection(ans);
      if (!parsed.ok) {
        if (parsed.reason === "user quit") return notSelected();
        out.write(`  ! ${parsed.reason}
`);
        continue;
      }
      const node = lookupSnapshot(mindmap, parsed.numberOrId, tree);
      if (!node) {
        out.write(`  ! no node matches "${parsed.numberOrId}"
`);
        continue;
      }
      const snapshot = parsed.mode === "continue" ? node.context_snapshot_continue : node.context_snapshot_fork;
      process.stdout.write(snapshot.clipboard_markdown);
      out.write(
        `

\u2713 ${parsed.mode} snapshot for ${node.id} written to stdout (${snapshot.clipboard_markdown.length} chars).
  Paste into a new \`claude\` session to resume from this point.
`
      );
      return { emitted: true, nodeId: node.id, mode: parsed.mode };
    }
  } finally {
    rl.close();
  }
}
function notSelected() {
  return { emitted: false, nodeId: null, mode: null };
}

// src/utils/clipboard.ts
import { spawn as spawn2 } from "node:child_process";
import { platform } from "node:os";
function copyToClipboard(text) {
  const cmd = pickCommand();
  if (!cmd) return Promise.resolve({ ok: false, reason: "no clipboard tool detected" });
  return new Promise((resolve5) => {
    try {
      const child = spawn2(cmd.command, cmd.args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", (err) => {
        resolve5({ ok: false, command: cmd.command, reason: err.message });
      });
      child.on("exit", (code) => {
        if (code === 0) resolve5({ ok: true, command: cmd.command });
        else resolve5({ ok: false, command: cmd.command, reason: `exit ${code}` });
      });
      child.stdin?.end(text, "utf8");
    } catch (err) {
      resolve5({
        ok: false,
        command: cmd.command,
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  });
}
function pickCommand() {
  const plat = platform();
  switch (plat) {
    case "darwin":
      return { command: "pbcopy", args: [] };
    case "win32":
      return { command: "clip", args: [] };
    default:
      return { command: "xclip", args: ["-selection", "clipboard"] };
  }
}

// src/utils/picks.ts
import { appendFile, mkdir as mkdir2, readFile as readFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2 } from "node:path";
var PICKS_ROOT = join2(homedir2(), ".cache", "agent-tree", "picks");
var SESSION_ID_RE = /^[0-9a-f-]{4,40}$/i;
function picksFileFor(sessionId, root = PICKS_ROOT) {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`refusing to compose picks path for invalid sessionId "${sessionId}"`);
  }
  return join2(root, `${sessionId}.jsonl`);
}
async function recordPick(sessionId, nodeId, mode, opts = {}) {
  const file = picksFileFor(sessionId, opts.root);
  await mkdir2(dirname(file), { recursive: true, mode: 448 });
  const entry = { node_id: nodeId, mode, ts: (/* @__PURE__ */ new Date()).toISOString() };
  await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}
async function listAllPicks(opts = {}) {
  const root = opts.root ?? PICKS_ROOT;
  const { readdir: readdir3 } = await import("node:fs/promises");
  let files;
  try {
    files = await readdir3(root);
  } catch {
    return [];
  }
  const out = [];
  for (const fname of files) {
    if (!fname.endsWith(".jsonl")) continue;
    const sessionId = fname.slice(0, -".jsonl".length);
    const filePath = join2(root, fname);
    let raw;
    try {
      raw = await readFile2(filePath, "utf8");
    } catch {
      continue;
    }
    const picks = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.node_id) picks.push(parsed);
      } catch {
      }
    }
    if (picks.length > 0) out.push({ sessionId, picks });
  }
  out.sort((a, b) => {
    const ta = a.picks[a.picks.length - 1]?.ts ?? "";
    const tb = b.picks[b.picks.length - 1]?.ts ?? "";
    return tb.localeCompare(ta);
  });
  return out;
}
async function removePicksForNode(sessionId, nodeId, opts = {}) {
  const file = picksFileFor(sessionId, opts.root);
  let raw;
  try {
    raw = await readFile2(file, "utf8");
  } catch {
    return 0;
  }
  const lines = raw.split("\n");
  let removed = 0;
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.node_id === nodeId) {
        removed += 1;
        continue;
      }
      kept.push(trimmed);
    } catch {
      kept.push(trimmed);
    }
  }
  if (removed === 0) return 0;
  const { writeFile: writeFile3, rename } = await import("node:fs/promises");
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile3(
    tmp,
    kept.length > 0 ? kept.join("\n") + "\n" : "",
    { encoding: "utf8", mode: 384 }
  );
  await rename(tmp, file);
  return removed;
}
async function readPicks(sessionId, opts = {}) {
  const file = picksFileFor(sessionId, opts.root);
  const index = { modesByNode: /* @__PURE__ */ new Map(), total: 0 };
  let raw;
  try {
    raw = await readFile2(file, "utf8");
  } catch {
    return index;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed.node_id || parsed.mode !== "continue" && parsed.mode !== "fork") {
        continue;
      }
      const set2 = index.modesByNode.get(parsed.node_id) ?? /* @__PURE__ */ new Set();
      set2.add(parsed.mode);
      index.modesByNode.set(parsed.node_id, set2);
      index.total += 1;
    } catch {
    }
  }
  return index;
}

// src/cli/modes.ts
async function runListMode(ctx) {
  const picks = await readPicks(ctx.match.sessionId);
  const tree = renderTextTree(ctx.mindmap, {
    filter: ctx.opts.filter,
    groupConsecutive: ctx.opts.group !== false,
    color: ctx.opts.color !== false && !!process.stdout.isTTY,
    picks: picks.modesByNode,
    maxDepth: ctx.opts.phasesOnly ? 1 : void 0
  });
  process.stdout.write(tree.text + "\n\n");
  process.stdout.write(
    `Pick a node by number. Re-run as:
  agent-tree ${ctx.match.sessionId.slice(0, 8)} --snapshot <number> --mode continue|fork
`
  );
  if (picks.total > 0) {
    const starred = picks.modesByNode.size;
    process.stdout.write(
      `(\u2B50 = previously picked \u2014 ${starred} node${starred === 1 ? "" : "s"} starred, ${picks.total} total pick${picks.total === 1 ? "" : "s"})
`
    );
  }
  return 0;
}
async function runSnapshotMode(ctx) {
  const tree = renderTextTree(ctx.mindmap);
  const node = lookupSnapshot(ctx.mindmap, ctx.opts.snapshot, tree);
  if (!node) {
    console.error(
      `error: no node matches "${ctx.opts.snapshot}". Run --list to see numbers.`
    );
    return 2;
  }
  const wantFork = (ctx.opts.mode ?? "continue") === "fork";
  const baseSnap = wantFork ? node.context_snapshot_fork : node.context_snapshot_continue;
  const sourceCwd = ctx.graph.events[0]?.cwd || process.cwd();
  const gitCtx = await getGitContext(sourceCwd);
  const gitMd = gitCtx.available ? formatGitContextMarkdown(gitCtx) : null;
  const finalMarkdown = gitMd ? appendGitSection(baseSnap.clipboard_markdown, gitMd) : baseSnap.clipboard_markdown;
  process.stdout.write(finalMarkdown);
  await recordPick(ctx.match.sessionId, node.id, wantFork ? "fork" : "continue").catch(
    (err) => ctx.logger.warn?.("pick history write failed", { error: String(err) })
  );
  if (process.stdout.isTTY && process.stderr.isTTY) {
    const result = await copyToClipboard(finalMarkdown);
    if (result.ok) {
      console.error(
        `
\u2713 ${wantFork ? "fork" : "continue"} snapshot for ${node.id} copied via ${result.command}.
  Paste into a new \`claude\` session to resume.`
      );
    } else {
      console.error(
        `
(snapshot above is also on stdout \u2014 pipe it: agent-tree ... --snapshot ${node.id} | pbcopy)`
      );
    }
  }
  return 0;
}
function appendGitSection(snapshotMd, gitMd) {
  const fullRefIdx = snapshotMd.indexOf("## Full session reference");
  if (fullRefIdx >= 0) {
    return snapshotMd.slice(0, fullRefIdx) + gitMd + "\n\n" + snapshotMd.slice(fullRefIdx);
  }
  return snapshotMd + "\n\n" + gitMd + "\n";
}
async function runPicksMode() {
  const all = await listAllPicks();
  if (all.length === 0) {
    process.stderr.write("No picks recorded yet.\n");
    return 0;
  }
  const lines = [];
  let totalPicks = 0;
  for (const session of all) {
    lines.push(`session ${session.sessionId.slice(0, 8)}  (${session.picks.length} pick${session.picks.length === 1 ? "" : "s"})`);
    for (const p of session.picks) {
      const when = p.ts.replace("T", " ").slice(0, 19);
      const mode = p.mode === "fork" ? "fork    " : "continue";
      lines.push(`  ${when}  ${mode}  ${p.node_id}`);
      totalPicks += 1;
    }
    lines.push("");
  }
  lines.push(`(${totalPicks} total pick${totalPicks === 1 ? "" : "s"} across ${all.length} session${all.length === 1 ? "" : "s"})`);
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
async function runUnstarMode(ctx) {
  const tree = renderTextTree(ctx.mindmap);
  const node = lookupSnapshot(ctx.mindmap, ctx.opts.unstar, tree);
  if (!node) {
    console.error(
      `error: no node matches "${ctx.opts.unstar}". Run --list to see numbers.`
    );
    return 2;
  }
  const removed = await removePicksForNode(ctx.match.sessionId, node.id);
  if (removed === 0) {
    process.stderr.write(`No picks recorded for ${node.id} \u2014 nothing to unstar.
`);
    return 0;
  }
  process.stderr.write(
    `\u2713 Unstarred ${node.id} \u2014 removed ${removed} pick entr${removed === 1 ? "y" : "ies"}.
`
  );
  return 0;
}
function runDiffMode(ctx) {
  const ids = ctx.opts.diff ?? [];
  if (ids.length !== 2) {
    console.error("error: --diff requires exactly two node ids/numbers (e.g. --diff 3 8).");
    return 2;
  }
  const tree = renderTextTree(ctx.mindmap);
  const a = lookupSnapshot(ctx.mindmap, ids[0], tree);
  const b = lookupSnapshot(ctx.mindmap, ids[1], tree);
  if (!a || !b) {
    console.error(
      `error: could not resolve both ids: a=${ids[0]} (${a ? "ok" : "missing"}), b=${ids[1]} (${b ? "ok" : "missing"})`
    );
    return 2;
  }
  const [from, to] = a.index_range[0] <= b.index_range[0] ? [a, b] : [b, a];
  const startEvent = from.index_range[0];
  const endEvent = to.index_range[1];
  const span = endEvent - startEvent + 1;
  const sliceSegments = ctx.segments.filter(
    (s) => s.start_index >= startEvent && s.end_index <= endEvent
  );
  const fileSet = /* @__PURE__ */ new Set();
  const toolSet = /* @__PURE__ */ new Set();
  for (const s of sliceSegments) {
    for (const f of s.dominant_files) fileSet.add(f);
    for (const t of s.dominant_tools) toolSet.add(t);
  }
  const lines = [];
  lines.push(`# Diff: ${from.id} \u2192 ${to.id}`);
  lines.push("");
  lines.push(`**From**: ${from.label}`);
  lines.push(`**To**:   ${to.label}`);
  lines.push("");
  lines.push(`- event range: ${startEvent}\u2013${endEvent} (${span} events)`);
  lines.push(`- segments crossed: ${sliceSegments.length}`);
  if (fileSet.size > 0) {
    lines.push(`- files touched (${fileSet.size}):`);
    for (const f of Array.from(fileSet).sort()) lines.push(`  - \`${f}\``);
  }
  if (toolSet.size > 0) {
    lines.push(`- tools used: ${Array.from(toolSet).sort().join(", ")}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
async function runTuiMode(ctx) {
  const result = await runTui(ctx.mindmap);
  return result.emitted ? 0 : 130;
}
var PROTECTED_DUMP_PREFIXES = [
  "/etc",
  "/var/log",
  "/var/db",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/System",
  "/Library/LaunchDaemons",
  "/Library/LaunchAgents"
];
async function dumpArtifacts(dir, graph, segments, mindmap, redactor) {
  const outDir = resolve2(dir);
  if (PROTECTED_DUMP_PREFIXES.some(
    (p) => outDir === p || outDir.startsWith(p + "/")
  )) {
    throw new Error(`refusing to dump into protected path: ${outDir}`);
  }
  await mkdir3(outDir, { recursive: true, mode: 448 });
  const safeMeta = redactDeep(graph.meta, redactor);
  const safeEvents = redactDeep(graph.events, redactor);
  const safeGraph = redactDeep(graphToDump(graph), redactor);
  const safeSegments = redactDeep(segments, redactor);
  const safeTree = redactDeep(mindmap, redactor);
  const opts = { encoding: "utf8", mode: 384, flag: "wx" };
  await Promise.all([
    writeFile2(
      resolve2(outDir, "raw-events.json"),
      JSON.stringify({ meta: safeMeta, events: safeEvents }, null, 2),
      opts
    ),
    writeFile2(
      resolve2(outDir, "graph.json"),
      JSON.stringify(safeGraph, null, 2),
      opts
    ),
    writeFile2(
      resolve2(outDir, "segments.json"),
      JSON.stringify(
        { session_id: graph.meta.sessionId, count: safeSegments.length, segments: safeSegments },
        null,
        2
      ),
      opts
    ),
    writeFile2(
      resolve2(outDir, "tree.json"),
      JSON.stringify(safeTree, null, 2),
      opts
    )
  ]);
}

// src/config/loader.ts
import { readFile as readFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join3, resolve as resolve3 } from "node:path";

// src/config/schema.ts
var DEFAULT_CONFIG = {
  llm: {
    enabled: true,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    max_input_tokens: 5e4,
    max_output_tokens: 5e3,
    cache: true,
    parallel: 3
  },
  redaction: {
    enabled: true,
    strict: false,
    extra_patterns: []
  },
  render: {
    lang: "auto"
  },
  analyzer: {
    sidechain_handling: "include",
    topic_gap_minutes: 5,
    file_jaccard_threshold: 0.3
  },
  cache: {
    dir: "~/.cache/agent-tree",
    enabled: true
  },
  log: {
    level: "info"
  },
  telemetry: {
    enabled: false
  }
};
function mergeConfig(target, source) {
  if (!source) return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const tv = out[k];
    if (isRecord2(v) && isRecord2(tv)) {
      out[k] = mergeConfig(
        tv,
        v
      );
    } else if (v !== void 0) {
      out[k] = v;
    }
  }
  return out;
}
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// src/config/loader.ts
var USER_CONFIG_DEFAULT = join3(
  homedir3(),
  ".config",
  "agent-tree",
  "config.yaml"
);
function envToPartial(env) {
  const out = {};
  const llm = {};
  if (env.AGENT_TREE_NO_LLM === "1" || env.AGENT_TREE_NO_LLM === "true") {
    llm.enabled = false;
  }
  if (env.AGENT_TREE_MODEL) llm.model = env.AGENT_TREE_MODEL;
  if (env.AGENT_TREE_MAX_TOK) {
    const n = parseInt(env.AGENT_TREE_MAX_TOK, 10);
    if (!Number.isNaN(n)) llm.max_input_tokens = n;
  }
  if (Object.keys(llm).length > 0) out.llm = llm;
  const redaction = {};
  if (env.AGENT_TREE_REDACT_STRICT === "1" || env.AGENT_TREE_REDACT_STRICT === "true") {
    redaction.strict = true;
  }
  if (Object.keys(redaction).length > 0) {
    out.redaction = redaction;
  }
  const render = {};
  if (env.AGENT_TREE_LANG === "ko" || env.AGENT_TREE_LANG === "en" || env.AGENT_TREE_LANG === "auto") {
    render.lang = env.AGENT_TREE_LANG;
  }
  if (Object.keys(render).length > 0) {
    out.render = render;
  }
  const log = {};
  if (env.AGENT_TREE_VERBOSE === "1" || env.AGENT_TREE_VERBOSE === "true") {
    log.level = "debug";
  }
  if (Object.keys(log).length > 0) out.log = log;
  return out;
}
async function readYamlIfPresent(path, logger) {
  try {
    const raw = await readFile3(path, "utf8");
    const mod = await Promise.resolve().then(() => (init_js_yaml(), js_yaml_exports));
    const parsed = mod.load(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") return null;
    logger?.warn?.(`failed to parse yaml at ${path}`, {
      error: String(err)
    });
    return null;
  }
}
async function loadConfig(opts = {}) {
  const env = opts.env ?? process.env;
  const projectCwd = opts.projectCwd ?? process.cwd();
  const userPath = opts.userConfigPath ?? USER_CONFIG_DEFAULT;
  const projectPath = resolve3(projectCwd, ".agent-tree.yaml");
  const [userYaml, projectYaml] = await Promise.all([
    readYamlIfPresent(userPath, opts.logger),
    readYamlIfPresent(projectPath, opts.logger)
  ]);
  const envPartial = envToPartial(env);
  let merged = DEFAULT_CONFIG;
  merged = mergeConfig(merged, userYaml);
  merged = mergeConfig(merged, projectYaml);
  merged = mergeConfig(merged, envPartial);
  return {
    config: merged,
    layers: {
      defaults: DEFAULT_CONFIG,
      user: userYaml,
      project: projectYaml,
      env: envPartial
    }
  };
}

// src/utils/logger.ts
var LEVEL_RANK = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};
function consoleLogger(level) {
  const emit = (lvl, msg, extra) => {
    if (LEVEL_RANK[lvl] < LEVEL_RANK[level]) return;
    const prefix = `[${lvl}]`;
    if (extra !== void 0) {
      console.error(prefix, msg, extra);
    } else {
      console.error(prefix, msg);
    }
  };
  return {
    trace: (m, x) => emit("trace", m, x),
    debug: (m, x) => emit("debug", m, x),
    info: (m, x) => emit("info", m, x),
    warn: (m, x) => emit("warn", m, x),
    error: (m, x) => emit("error", m, x),
    level
  };
}
function createLoggerSync(level = "info") {
  return consoleLogger(level);
}

// src/utils/picker.ts
import { readdir as readdir2, stat as stat2 } from "node:fs/promises";
import { createInterface as createInterface3 } from "node:readline/promises";
import { join as join5 } from "node:path";

// src/utils/session_path.ts
import { readdir, stat } from "node:fs/promises";
import { homedir as homedir4 } from "node:os";
import { join as join4 } from "node:path";
var CLAUDE_PROJECTS_ROOT = join4(homedir4(), ".claude", "projects");
function encodeProjectPath(absPath) {
  return absPath.replace(/\//g, "-");
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var UUID_LOOSE = /^[0-9a-f-]+$/i;
function isFullUuid(s) {
  return UUID_RE.test(s);
}
function isUuidPrefix(s) {
  return UUID_LOOSE.test(s) && s.length >= 4 && s.length <= 36;
}
async function locateSession(sessionIdOrPrefix, opts = {}) {
  const root = opts.projectsRoot ?? CLAUDE_PROJECTS_ROOT;
  const prefix = sessionIdOrPrefix.toLowerCase();
  if (!isUuidPrefix(prefix) && !isFullUuid(prefix)) {
    throw new Error(
      `session id "${sessionIdOrPrefix}" is not a valid UUID or prefix`
    );
  }
  const projectDirs = await safeReaddir(root);
  const matches = [];
  for (const projectDir of projectDirs) {
    const projectPath = join4(root, projectDir);
    const files = await safeReaddir(projectPath);
    for (const fname of files) {
      if (!fname.endsWith(".jsonl")) continue;
      const id = fname.slice(0, -".jsonl".length);
      if (!id.toLowerCase().startsWith(prefix)) continue;
      const fullPath = join4(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(fullPath)).mtimeMs;
      } catch {
      }
      matches.push({
        sessionId: id,
        projectDir,
        jsonlPath: fullPath,
        mtimeMs
      });
    }
  }
  matches.sort((a, b) => {
    if (opts.projectHint) {
      const aHit = a.projectDir === opts.projectHint ? 1 : 0;
      const bHit = b.projectDir === opts.projectHint ? 1 : 0;
      if (aHit !== bHit) return bHit - aHit;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return matches.map(({ mtimeMs: _m, ...rest }) => rest);
}
async function findLatestSession(projectsRoot = CLAUDE_PROJECTS_ROOT) {
  const projectDirs = await safeReaddir(projectsRoot);
  let best = null;
  for (const projectDir of projectDirs) {
    const projectPath = join4(projectsRoot, projectDir);
    const files = await safeReaddir(projectPath);
    for (const fname of files) {
      if (!fname.endsWith(".jsonl")) continue;
      const id = fname.slice(0, -".jsonl".length);
      const fullPath = join4(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(fullPath)).mtimeMs;
      } catch {
        continue;
      }
      if (!best || mtimeMs > best.mtimeMs) {
        best = { sessionId: id, projectDir, jsonlPath: fullPath, mtimeMs };
      }
    }
  }
  if (!best) return null;
  const { mtimeMs: _m, ...rest } = best;
  return rest;
}
async function findLatestSessionInProject(cwd, projectsRoot = CLAUDE_PROJECTS_ROOT) {
  const projectDir = encodeProjectPath(cwd);
  const projectPath = join4(projectsRoot, projectDir);
  const files = await safeReaddir(projectPath);
  let best = null;
  for (const fname of files) {
    if (!fname.endsWith(".jsonl")) continue;
    const id = fname.slice(0, -".jsonl".length);
    const fullPath = join4(projectPath, fname);
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(fullPath)).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtimeMs > best.mtimeMs) {
      best = { sessionId: id, projectDir, jsonlPath: fullPath, mtimeMs };
    }
  }
  if (!best) return null;
  const { mtimeMs: _m, ...rest } = best;
  return rest;
}
async function safeReaddir(path) {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

// src/utils/picker.ts
async function pickSession(opts = {}) {
  const limit = opts.limit ?? 10;
  const candidates = await listRecentSessions(
    opts.projectsRoot ?? CLAUDE_PROJECTS_ROOT,
    limit
  );
  if (candidates.length === 0) return null;
  const out = opts.output ?? process.stderr;
  out.write("Recent Claude Code sessions:\n");
  candidates.forEach((c, i) => {
    const when = new Date(c.mtimeMs).toISOString().replace("T", " ").slice(0, 16);
    out.write(
      `  ${String(i + 1).padStart(2, " ")}. ${c.sessionId.slice(0, 8)}  ${when}  ${c.projectDir}
`
    );
  });
  const rl = createInterface3({
    input: opts.input ?? process.stdin,
    output: opts.output ?? process.stderr
  });
  const answer = (await rl.question("Pick a number (blank to cancel): ")).trim();
  rl.close();
  if (answer.length === 0) return null;
  const idx = parseInt(answer, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > candidates.length) return null;
  const picked = candidates[idx - 1];
  return {
    sessionId: picked.sessionId,
    projectDir: picked.projectDir,
    jsonlPath: picked.jsonlPath
  };
}
async function listRecentSessions(root, limit) {
  const projectDirs = await safeReaddir2(root);
  const out = [];
  for (const projectDir of projectDirs) {
    const projectPath = join5(root, projectDir);
    const files = await safeReaddir2(projectPath);
    for (const fname of files) {
      if (!fname.endsWith(".jsonl")) continue;
      const jsonlPath = join5(projectPath, fname);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat2(jsonlPath)).mtimeMs;
      } catch {
        continue;
      }
      out.push({
        sessionId: fname.slice(0, -".jsonl".length),
        projectDir,
        jsonlPath,
        mtimeMs
      });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}
async function safeReaddir2(p) {
  try {
    return await readdir2(p);
  } catch {
    return [];
  }
}

// src/cli.ts
async function main(argv = process.argv) {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) return parsed.exitCode;
  const { opts, sessionArg } = parsed;
  const level = opts.trace ? "trace" : opts.verbose ? "debug" : "info";
  const logger = createLoggerSync(level);
  const { config } = await loadConfig({ logger });
  if (opts.picks) {
    return runPicksMode();
  }
  const match = await resolveSession(sessionArg, opts, logger);
  if (!match) return match === null ? 130 : 2;
  logger.debug(`session located`, {
    sessionId: match.sessionId,
    jsonl: match.jsonlPath
  });
  const mode = resolveMode(opts, !!process.stdout.isTTY);
  const quiet = (mode.list || mode.snapshot || mode.tui) && !opts.verbose && !opts.trace;
  const result = await runPipeline({ match, opts, config, logger, quiet });
  if (result.isEmpty) {
    console.error("No turns found \u2014 empty session. Exiting.");
    return 0;
  }
  if (opts.dumpJson) {
    await dumpArtifacts(
      opts.dumpJson,
      result.graph,
      result.segments,
      result.mindmap,
      result.redactor
    );
    logger.info(`dumped JSON artifacts`, { dir: resolve4(opts.dumpJson) });
  }
  if (opts.dryRun) {
    process.stderr.write("Dry-run \u2014 analysis complete, no output written.\n");
    return 0;
  }
  const ctx = {
    match,
    opts,
    config,
    logger,
    mindmap: result.mindmap,
    graph: result.graph,
    segments: result.segments,
    redactor: result.redactor,
    cacheHash: result.cacheHash
  };
  if (mode.unstar) return runUnstarMode(ctx);
  if (mode.diff) return runDiffMode(ctx);
  if (mode.list) return runListMode(ctx);
  if (mode.snapshot) return runSnapshotMode(ctx);
  if (mode.tui) return runTuiMode(ctx);
  console.error("internal error: no output mode resolved");
  return 1;
}
async function resolveSession(sessionArg, opts, logger) {
  if (opts.pick) {
    const picked = await pickSession();
    if (!picked) {
      console.error("Selection cancelled.");
      return null;
    }
    return picked;
  }
  if (opts.latest) {
    const latest = await findLatestSession();
    if (!latest) {
      console.error("error: no sessions found under ~/.claude/projects/.");
      return void 0;
    }
    return latest;
  }
  if (!sessionArg) {
    const inProject = await findLatestSessionInProject(process.cwd());
    if (inProject) {
      logger.debug("smart default \u2192 this project's latest session", {
        sessionId: inProject.sessionId
      });
      return inProject;
    }
    const global = await findLatestSession();
    if (global) {
      console.error(
        `(no session in this project \u2014 falling back to globally latest: ${global.sessionId.slice(0, 8)} from ${global.projectDir})`
      );
      return global;
    }
    console.error("error: no sessions found under ~/.claude/projects/.");
    return void 0;
  }
  const matches = await locateSession(sessionArg);
  if (matches.length === 0) {
    console.error(
      `error: no session matched "${sessionArg}" under ~/.claude/projects/.`
    );
    return void 0;
  }
  if (matches.length > 1) {
    const lines = matches.slice(0, 5).map((m) => `  \u2022 ${m.sessionId}  (${m.projectDir})`).join("\n");
    console.error(
      `error: "${sessionArg}" is ambiguous; ${matches.length} matches:
${lines}

Re-run with a longer prefix.`
    );
    return void 0;
  }
  return matches[0];
}
var invokedDirectly = typeof process !== "undefined" && process.argv[1] && /(^|\/)(cli\.(m?js|ts)|agent-tree|atree)$/.test(
  process.argv[1]
);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("fatal:", err);
      process.exit(1);
    }
  );
}
export {
  main
};
/*! Bundled license information:

js-yaml/dist/js-yaml.mjs:
  (*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT *)
*/
//# sourceMappingURL=cli.js.map
