//Requires
const HttpClass  = require('http');
const Koa = require('koa');
const KoaBodyParser = require('koa-bodyparser');
const KoaServe = require('koa-static');
const KoaSession = require('koa-session');
const KoaSessionMemoryStoreClass = require('koa-session-memory');
const nanoid = require('nanoid');
// const { setHttpCallback } = require('@citizenfx/http-wrapper');
const { setHttpCallback } = require('./wrapper.ignore.js'); //FIXME: REMOVE
const { dir, log, logOk, logWarn, logError, cleanTerminal } = require('../../extras/console');
const ctxUtils = require('./ctxUtils.js');
const context = 'WebServer';

module.exports = class WebServer {
    constructor(config, httpPort) {
        this.config = config;
        this.httpPort = httpPort; //NOTE: remove when adding support for multi-server
        this.intercomToken = nanoid();

        this.setupKoa();
        this.setupServerCallbacks();
    }


    //================================================================
    setupKoa(){
        //Start Koa
        this.app = new Koa();
        this.app.keys = ['txAdmin'+nanoid()];

        //Session
        this.koaSessionMemoryStore = new KoaSessionMemoryStoreClass();
        this.sessionInstance = KoaSession({
            store: this.koaSessionMemoryStore,
            key: `txAdmin:${globals.config.serverProfile}:sess`,
            rolling: true,
            maxAge: 24*60*60*1000 //one day
        }, this.app);


        //FIXME: text render middleware - PS: thefuck does that mean?
        this.app.use(ctxUtils);
        
        //Setting up timeout/error/404/413:
        let timeoutLimit = 5 * 1000;
        let jsonLimit = '16MB';
        this.app.use(async (ctx, next) => {
            let timer; 
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    ctx.state.timeout = true;
                    reject();
                }, timeoutLimit);
            });
            try {
                await Promise.race([timeout, next()]);
                clearTimeout(timer);
                if (typeof ctx.status !== 'undefined' && ctx.status === 404) {
                    if(globals.config.verbose) logWarn(`Request 404 error: ${ctx.path}`, context);
                    return ctx.utils.render('basic/404');
                }
            } catch (error) {
                //TODO: add middleware name instead of using ctx.path for logging
                //TODO: perhaps we should also have a koa-bodyparser generic error handler?
                if(error.type === 'entity.too.large'){
                    ctx.status = 413;
                    ctx.body = {error: 'request entity too large'};
                }else if (ctx.state.timeout){
                    let desc = `Route timed out: ${ctx.path}`;
                    logError(desc, context);
                    ctx.status = 408;
                    ctx.body = desc;
                }else{
                    let desc = `Internal Error on: ${ctx.path}`;
                    logError(desc, context);
                    if(globals.config.verbose) dir(error)
                    ctx.status = 500;
                    ctx.body = desc;
                }
            }
        });
        //Setting up additional middlewares:
        this.app.use(KoaServe('web/public', {index: false}));
        this.app.use(this.sessionInstance);
        this.app.use(KoaBodyParser({jsonLimit}));

        //Setting up routes
        this.router = require('./router')(this.config);
        this.app.use(this.router.routes())
        this.app.use(this.router.allowedMethods());
    }


    //================================================================
    setupServerCallbacks(){
        //CitizenFX Callback
        try {
            //FIXME: fix this part?
            let run = ExecuteCommand("endpoint_add_tcp \"0.0.0.0:30120\"");
            setHttpCallback(this.app.callback());
        } catch (error) {
            logError('::Failed to start CitizenFX Reverse Proxy Callback with error:', context);
            dir(error);
        }

        //HTTP Server
        try {
            this.httpServer = HttpClass.createServer(this.app.callback());
            this.httpServer.on('error', (error)=>{
                if(error.code !== 'EADDRINUSE') return;
                logError(`Failed to start HTTP server, port ${error.port} already in use.`, context);
                process.exit();
            });
            this.httpServer.listen(this.httpPort, '0.0.0.0', () => {
                logOk(`::Started at http://localhost:${this.httpPort}/`, context);
                globals.webConsole.attachSocket(this.httpServer);
            });
        } catch (error) {
            logError('::Failed to start HTTP server with error:', context);
            dir(error);
            process.exit();
        }
    }

} //Fim WebServer()
