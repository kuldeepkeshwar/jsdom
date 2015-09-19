"use strict";

require("./newapi1/basics.js");
require("./newapi1/fragment.js");
require("./newapi1/from-file.js");
require("./newapi1/from-url.js");
require("./newapi1/methods.js");
require("./newapi1/options.js");

require("./jsdom/cancel-requests.js");
require("./jsdom/cookie.js");

require("./jsdom/encoding.js");
require("./jsdom/env.js");
require("./jsdom/inside-worker-smoke-tests.js");
require("./jsdom/keep-alive-connections.js");
require("./jsdom/misc.js");
require("./jsdom/named-properties-tracker.js");
require("./jsdom/namespaces.js");
require("./jsdom/node-location.js");
require("./jsdom/parsing.js");
require("./jsdom/reconfigure-window.js");
require("./jsdom/resource-loading.js");
require("./jsdom/selectors.js");
require("./jsdom/serialization.js");
require("./jsdom/utils.js");
require("./jsdom/virtual-console.js");
require("./jsdom/xml.js");

require("./browser/css.js");
require("./browser/index.js");

require("./jsonp/jsonp.js");

require("./level1/core.js");
require("./level1/html.js");

require("./web-platform-tests/to-upstream.js");
// keep this one last so that you can cancel the test run early
require("./web-platform-tests/index.js");
