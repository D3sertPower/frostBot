'use strict';

function format(prefix, lines) {
  const text = (Array.isArray(lines) ? lines : [lines])
    .filter((line) => line !== undefined && line !== null)
    .join('\n')
    .trim();

  return `${prefix} ${text}`;
}

function quote(lines) {
  return format('/quote', lines);
}

function pre(lines) {
  return format('/pre', lines);
}

function code(lines) {
  return format('/code', lines);
}

module.exports = { code, pre, quote };
