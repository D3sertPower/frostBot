'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const executionStorage = new AsyncLocalStorage();
const MAX_INTERACTION_DEPTH = 10;

let commandRegistry;

class InteractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InteractionError';
    this.code = code;
  }
}

function configureInteractions(commands) {
  if (!(commands instanceof Map)) {
    throw new TypeError('commands must be a Map');
  }

  commandRegistry = commands;
}

function requireRegistry() {
  if (!commandRegistry) {
    throw new InteractionError(
      'REGISTRY_NOT_CONFIGURED',
      'The command registry has not been configured.',
    );
  }

  return commandRegistry;
}

function normalizeIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    return null;
  }

  return identifier.trim().toLowerCase().replace(/^!/, '');
}

function resolveCommand(identifier) {
  if (identifier && typeof identifier.run === 'function') {
    return identifier;
  }

  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const commands = requireRegistry();
  const directCommand = commands.get(`!${normalizedIdentifier}`);

  if (directCommand) {
    return directCommand;
  }

  return Array.from(commands.values()).find((command) =>
    command.aliases?.some(
      (alias) => normalizeIdentifier(alias) === normalizedIdentifier,
    ),
  ) ?? null;
}

function createFailure(error, commandName, stack) {
  return {
    ok: false,
    command: commandName ?? null,
    code: error.code ?? 'COMMAND_FAILED',
    error,
    stack,
  };
}

async function executeCommand(identifier, args = [], options = {}) {
  const {
    mode = 'value',
    metadata = {},
    throwOnError = mode !== 'result',
  } = options;

  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array');
  }

  if (mode !== 'value' && mode !== 'result') {
    throw new TypeError("mode must be either 'value' or 'result'");
  }

  let command;

  try {
    command = resolveCommand(identifier);
  } catch (error) {
    if (throwOnError) {
      throw error;
    }

    return createFailure(error, null, []);
  }

  if (!command) {
    const error = new InteractionError(
      'COMMAND_NOT_FOUND',
      `Command '${String(identifier)}' was not found.`,
    );

    if (throwOnError) {
      throw error;
    }

    return createFailure(error, null, []);
  }

  const parentInteraction = executionStorage.getStore();
  const parentStack = parentInteraction?.stack ?? [];
  const commandName = command.name.toLowerCase();
  const stack = [...parentStack, commandName];

  if (parentStack.includes(commandName)) {
    const error = new InteractionError(
      'CIRCULAR_INTERACTION',
      `Circular command interaction detected: ${stack.join(' -> ')}`,
    );

    if (throwOnError) {
      throw error;
    }

    return createFailure(error, commandName, stack);
  }

  if (stack.length > MAX_INTERACTION_DEPTH) {
    const error = new InteractionError(
      'MAX_INTERACTION_DEPTH',
      `Command interaction exceeded ${MAX_INTERACTION_DEPTH} calls.`,
    );

    if (throwOnError) {
      throw error;
    }

    return createFailure(error, commandName, stack);
  }

  const interaction = {
    command: commandName,
    metadata: {
      ...(parentInteraction?.metadata ?? {}),
      ...metadata,
    },
    stack,
  };

  try {
    const value = await executionStorage.run(
      interaction,
      () => command.run(...args),
    );

    const result = {
      ok: true,
      command: commandName,
      value,
      metadata: interaction.metadata,
      stack,
    };

    return mode === 'result' ? result : value;
  } catch (error) {
    if (throwOnError) {
      throw error;
    }

    return createFailure(error, commandName, stack);
  }
}

function invokeCommand(identifier, args = [], options = {}) {
  return executeCommand(identifier, args, options);
}

function callInteraction(identifier, args = [], options = {}) {
  const normalizedArgs = Array.isArray(args) ? args : [args];
  return executeCommand(identifier, normalizedArgs, options);
}

function getCurrentInteraction() {
  return executionStorage.getStore() ?? null;
}

module.exports = {
  InteractionError,
  callInteraction,
  configureInteractions,
  executeCommand,
  getCurrentInteraction,
  invokeCommand,
  resolveCommand,
};
