const express = require('express'),
  bodyParser = require('body-parser'),
  envVariables = require('./env-variables'),
  port = envVariables.port;
const createAppServer = () => {
const app = express();
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS')
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization,' + 'cid, user-id, x-auth, Cache-Control, X-Requested-With, datatype, *')
        if (req.method === 'OPTIONS') res.sendStatus(200)
        else next()
    })
    app.use(bodyParser.json({ limit: '10mb' }));
    // app.use(logger('dev'));
    app.use(express.json());
    app.use(bodyParser.urlencoded({ limit: '10mb', extended: true, parameterLimit: 50000 }));
    // app.use(cookieParser());
    app.use(envVariables.contextPath, require('./channel/routes'));

    // Dev-only catch-all proxy, OFF unless DEV_PROXY_ENABLED=true.
    //
    // This forwards every path the chatbot does not own to the DIGIT services host. It
    // exists so the react-app dialog harness can call DIGIT APIs same-origin during local
    // dialog development (see LOCALSETUP.md). On a publicly reachable deployment it turns
    // the container into an open proxy onto internal DIGIT APIs, so it must stay off --
    // and the Twilio webhook requires the container to be publicly reachable.
    if (envVariables.devProxyEnabled) {
        console.warn(
            'DEV_PROXY_ENABLED=true: proxying all unmatched paths to ' +
            envVariables.egovServices.egovServicesHost +
            '. This is for local dialog development only -- never enable it on a reachable deployment.'
        );
        const { createProxyMiddleware } = require('http-proxy-middleware');
        app.use(createProxyMiddleware('/', { target: envVariables.egovServices.egovServicesHost }));
    } else {
        // Anything outside the chatbot's own context path is simply not ours.
        app.use((req, res) => res.sendStatus(404));
    }
    return app;
}

require('./config-check').logAtStartup();

const app = createAppServer();
module.exports = app;
app.listen(port, () => console.log(`XState-Chatbot-Server is running on port ${envVariables.port} with contextPath: ${envVariables.contextPath}`));
