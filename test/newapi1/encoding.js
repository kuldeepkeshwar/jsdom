"use strict";
const fs = require("pn/fs");
const path = require("path");
const assert = require("chai").assert;
const describe = require("mocha-sugar-free").describe;
const it = require("mocha-sugar-free").it;

const { JSDOM } = require("../../lib/newapi1.js");

function fixturePath(fixture) {
  return path.resolve(__dirname, "fixtures/encoding", fixture);
}

function readFixture(fixture) {
  return fs.readFile(fixturePath(fixture));
}

const factories = {
  Buffer: fixture => readFixture(fixture),
  Uint8Array: fixture => readFixture(fixture).then(buffer => Uint8Array.from(buffer)),
  ArrayBuffer: fixture => readFixture(fixture).then(buffer => buffer.buffer),
  DataView: fixture => readFixture(fixture).then(buffer => new DataView(buffer.buffer)),
  Int8Array: fixture => readFixture(fixture).then(buffer => new Int8Array(buffer.buffer))
};

const encodingFixtures = {
  "no-bom-charset-http-equiv-no-quotes.html": "ISO-8859-5",
  "no-bom-charset-http-equiv-tis-620.html": "windows-874",
  "no-bom-charset-koi8.html": "KOI8-R",
  "no-bom-charset-utf-16.html": "UTF-8",
  "no-bom-charset-utf-16be.html": "UTF-8",
  "no-bom-charset-utf-16le.html": "UTF-8",
  "no-bom-no-charset.html": "windows-1252",
  "utf-8-bom.html": "UTF-8",
  "utf-16be-bom.html": "UTF-16BE",
  "utf-16le-bom.html": "UTF-16LE"
};

describe("newapi1 encoding detection", () => {
  describe("constructor, given a string", () => {
    it("should default to UTF-8 when passing a string", () => {
      const dom = new JSDOM("©");

      assert.strictEqual(dom.window.document.characterSet, "UTF-8");
      assert.strictEqual(dom.window.document.body.textContent, "©");
    });

    it("should default to UTF-8 when passing nothing", () => {
      const dom = new JSDOM();

      assert.strictEqual(dom.window.document.characterSet, "UTF-8");
      assert.strictEqual(dom.window.document.body.textContent, "");
    });

    it("should default to UTF-8 when passing null", () => {
      const dom = new JSDOM(null);

      assert.strictEqual(dom.window.document.characterSet, "UTF-8");
      assert.strictEqual(dom.window.document.body.textContent, "null");
    });
  });

  describe("constructor, given binary data", () => {
    for (const binaryDataType of Object.keys(factories)) {
      const factory = factories[binaryDataType];

      describe(binaryDataType, () => {
        for (const encodingFixture of Object.keys(encodingFixtures)) {
          const desiredLabel = encodingFixtures[encodingFixture];

          it(`should sniff ${encodingFixture} as ${desiredLabel}`, () => {
            return factory(encodingFixture).then(binaryData => {
              assert.strictEqual(binaryData.constructor.name, binaryDataType,
                "Sanity check: input binary data must be of the right type");

              const dom = new JSDOM(binaryData);

              assert.strictEqual(dom.window.document.characterSet, desiredLabel);
            });
          });
        }
      });
    }
  });

  describe("fromFile", () => {
    for (const encodingFixture of Object.keys(encodingFixtures)) {
      const desiredLabel = encodingFixtures[encodingFixture];

      it(`should sniff ${encodingFixture} as ${desiredLabel}`, () => {
        return JSDOM.fromFile(fixturePath(encodingFixture)).then(dom => {
          assert.strictEqual(dom.window.document.characterSet, desiredLabel);
        });
      });
    }
  });
});
