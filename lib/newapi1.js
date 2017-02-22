"use strict";
const path = require("path");
const fs = require("pn/fs");
const vm = require("vm");
const toughCookie = require("tough-cookie");
const request = require("request-promise-native");
const sniffHTMLEncoding = require("html-encoding-sniffer");
const whatwgURL = require("whatwg-url");
const whatwgEncoding = require("whatwg-encoding");
const { URL } = require("whatwg-url");
const parseContentType = require("content-type-parser");
const idlUtils = require("./jsdom/living/generated/utils.js");
const VirtualConsole = require("./jsdom/virtual-console.js");
const Window = require("./jsdom/browser/Window.js");
const { locationInfo } = require("./jsdom/living/helpers/internal-constants.js");
const { domToHtml } = require("./jsdom/browser/domtohtml.js");
const { applyDocumentFeatures } = require("./jsdom/browser/documentfeatures.js");
const { wrapCookieJarForRequest } = require("./jsdom/browser/resource-loader.js");
const { version: packageVersion } = require("../package.json");

const DEFAULT_USER_AGENT = `Mozilla/5.0 (${process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
                           `jsdom/${packageVersion}`;

class CookieJar extends toughCookie.CookieJar {
  constructor(store, options) {
    // jsdom cookie jars must be loose by default
    super(store, Object.assign({ looseMode: true }, options));
  }
}

const window = Symbol("window");

class JSDOM {
  constructor(input, options) {
    const { html, encoding } = normalizeHTML(input);
    options = transformOptions(options, encoding);

    this[window] = new Window(options.windowOptions);

    // TODO NEWAPI: the whole "features" infrastructure is horrible and should be re-built. When we switch to newapi
    // wholesale, or perhaps before, we should re-do it. For now, just adapt the new, nice, public API into the old,
    // ugly, internal API.
    const features = {
      FetchExternalResources: [],
      ProcessExternalResources: false,
      SkipExternalResources: false
    };
    if (options.runScripts === "dangerously") {
      features.ProcessExternalResources = ["script"];
    }

    const documentImpl = idlUtils.implForWrapper(this[window]._document);
    applyDocumentFeatures(documentImpl, features);

    if (options.runScripts === "outside-only") {
      vm.createContext(this[window]);
      this[window]._document._defaultView = this[window]._globalProxy = vm.runInContext("this", this[window]);
    }

    options.beforeParse(this[window]._globalProxy);

    // TODO NEWAPI: this is still pretty hacky. It's also different than jsdom.jsdom. Does it work? Can it be better?
    documentImpl._htmlToDom.appendHtmlToDocument(html, documentImpl);
    documentImpl.close();
  }

  get window() {
    // It's important to grab the global proxy, instead of just the result of `new Window(...)`, since otherwise things
    // like `window.eval` don't exist.
    return this[window]._globalProxy;
  }

  get virtualConsole() {
    return this[window]._virtualConsole;
  }

  get cookieJar() {
    // TODO NEWAPI move _cookieJar to window probably
    return idlUtils.implForWrapper(this[window]._document)._cookieJar;
  }

  serialize() {
    return domToHtml([this[window]._document]);
  }

  nodeLocation(node) {
    if (!idlUtils.implForWrapper(this[window]._document)._parseOptions.locationInfo) {
      throw new Error("Location information was not saved for this jsdom. Use includeNodeLocations during creation.");
    }

    return idlUtils.implForWrapper(node)[locationInfo];
  }

  runVMScript(script) {
    if (!vm.isContext(this[window])) {
      throw new TypeError("This jsdom was not configured to allow script running. " +
        "Use the runScripts option during creation.");
    }

    return script.runInContext(this[window]);
  }

  reconfigure(settings) {
    if ("windowTop" in settings) {
      this[window]._top = settings.windowTop;
    }

    if ("url" in settings) {
      const document = idlUtils.implForWrapper(this[window]._document);

      const url = whatwgURL.parseURL(settings.url);
      if (url === "failure") {
        throw new TypeError(`Could not parse "${settings.url}" as a URL`);
      }

      document._URL = url;
      document._origin = whatwgURL.serializeURLToUnicodeOrigin(document._URL);
    }
  }

  static fragment(string, options) {
    const dom = new JSDOM(``, options);
    const template = dom.window.document.createElement("template");
    template.innerHTML = string;
    return template.content;
  }

  static fromURL(url, options) {
    return Promise.resolve().then(() => {
      url = (new URL(url)).href;
      options = normalizeFromURLOptions(options);

      const requestOptions = {
        resolveWithFullResponse: true,
        gzip: true,
        headers: {
          "User-Agent": options.userAgent,
          Referer: options.referrer,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en"
        },
        jar: wrapCookieJarForRequest(options.cookieJar)
      };

      return request(url, requestOptions).then(res => {
        options = Object.assign(options, {
          url: res.request.href,
          contentType: res.headers["content-type"],
          referrer: res.request.getHeader("referer")
        });

        // TODO: implement proper decoding, like resource loader does.
        return new JSDOM(res.body, options);
      });
    });
  }

  static fromFile(filename, options) {
    return Promise.resolve().then(() => {
      options = normalizeFromFileOptions(filename, options);

      return fs.readFile(filename).then(buffer => {
        return new JSDOM(buffer, options);
      });
    });
  }
}

function normalizeFromURLOptions(options = {}) {
  // Checks on options that are invalid for `fromURL`
  if (options.url !== undefined) {
    throw new TypeError("Cannot supply a url option when using fromURL");
  }
  if (options.contentType !== undefined) {
    throw new TypeError("Cannot supply a contentType option when using fromURL");
  }

  // Normalization of options which must be done before the rest of the fromURL code can use them, because they are
  // given to request()
  const normalized = Object.assign({}, options);
  if (options.userAgent === undefined) {
    normalized.userAgent = DEFAULT_USER_AGENT;
  }

  if (options.referrer !== undefined) {
    normalized.referrer = (new URL(options.referrer)).href;
  }

  if (options.cookieJar === undefined) {
    normalized.cookieJar = new CookieJar();
  }

  return normalized;

  // All other options don't need to be processed yet, and can be taken care of in the normal course of things when
  // `fromURL` calls `new JSDOM(html, options)`.
}

function normalizeFromFileOptions(filename, options = {}) {
  const normalized = Object.assign({}, options);

  if (normalized.contentType === undefined) {
    const extname = path.extname(filename);
    if (extname === ".xhtml" || extname === ".xml") {
      normalized.contentType = "application/xhtml+xml";
    }
  }

  if (normalized.url === undefined) {
    normalized.url = new URL("file:" + path.resolve(filename));
  }

  return normalized;
}

function transformOptions(options = {}, encoding) {
  const transformed = {
    windowOptions: {
      // Defaults
      url: "about:blank",
      referrer: "",
      contentType: "text/html",
      parsingMode: "html",
      userAgent: DEFAULT_USER_AGENT,
      parseOptions: { locationInfo: false },
      encoding,

      // Defaults filled in later
      virtualConsole: undefined,
      cookieJar: undefined
    },

    // Defaults
    runScripts: undefined,
    beforeParse() { }
  };

  if (options.contentType !== undefined) {
    const contentTypeParsed = parseContentType(options.contentType);
    if (contentTypeParsed === null) {
      throw new TypeError(`Could not parse the given content type of "${options.contentType}"`);
    }

    if (!contentTypeParsed.isHTML() && !contentTypeParsed.isXML()) {
      throw new RangeError(`The given content type of "${options.contentType}" was not a HTML or XML content type`);
    }

    transformed.windowOptions.contentType = contentTypeParsed.type + "/" + contentTypeParsed.subtype;
    transformed.windowOptions.parsingMode = contentTypeParsed.isHTML() ? "html" : "xml";
  }

  if (options.url !== undefined) {
    transformed.windowOptions.url = (new URL(options.url)).href;
  }

  if (options.referrer !== undefined) {
    transformed.windowOptions.referrer = (new URL(options.referrer)).href;
  }

  if (options.userAgent !== undefined) {
    transformed.windowOptions.userAgent = String(options.userAgent);
  }

  if (options.includeNodeLocations) {
    if (transformed.windowOptions.parsingMode === "xml") {
      throw new TypeError("Cannot set includeNodeLocations to true with an XML content type");
    }

    transformed.windowOptions.parseOptions = { locationInfo: true };
  }

  transformed.windowOptions.cookieJar = options.cookieJar === undefined ?
                                       new CookieJar() :
                                       options.cookieJar;

  transformed.windowOptions.virtualConsole = options.virtualConsole === undefined ?
                                            (new VirtualConsole()).sendTo(console) :
                                            options.virtualConsole;

  if (options.runScripts !== undefined) {
    transformed.runScripts = String(options.runScripts);
    if (transformed.runScripts !== "dangerously" && transformed.runScripts !== "outside-only") {
      throw new RangeError(`runScripts must be undefined, "dangerously", or "outside-only"`);
    }
  }

  if (options.beforeParse !== undefined) {
    transformed.beforeParse = options.beforeParse;
  }

  // concurrentNodeIterators??

  return transformed;
}

function normalizeHTML(html = "") {
  let encoding = "UTF-8";

  if (ArrayBuffer.isView(html)) {
    html = html.buffer;
  }

  if (html instanceof ArrayBuffer) {
    const buffer = Buffer.from(html);
    encoding = sniffHTMLEncoding(buffer, { defaultEncoding: "windows-1252" });
    html = whatwgEncoding.decode(buffer, encoding);
  } else {
    html = String(html);
  }

  return { html, encoding };
}

exports.JSDOM = JSDOM;

exports.VirtualConsole = VirtualConsole;
exports.CookieJar = CookieJar;

exports.toughCookie = toughCookie;
