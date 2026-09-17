// src/machine/flow/flow-state.console-test.js
const readline = require('readline');
const { Machine, interpret } = require('xstate');
const compile = require('./flow-state-compiler');
const consoleProvider = require('../../channel/console');
const { confirmName, updateProfile, changeName, thankYou } = require('./flow-state.example.js');


const chatInterface = {
  toUser: (user, output, extraInfo) => consoleProvider.sendMessageToUser(user, output, extraInfo)
};

const config = compile([confirmName, updateProfile, changeName, thankYou], 'confirmName');

const machine = Machine(config).withContext({
  user: { locale: 'en_IN' },
  extraInfo: {},
  chatInterface
});

const service = interpret(machine).start();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
  service.send('USER_MESSAGE', { message: { input: line } });
  if (service.state.done || !service.state.can('USER_MESSAGE')) rl.close();
});

