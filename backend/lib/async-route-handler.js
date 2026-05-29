'use strict';

const ROUTE_METHODS = [
  'all',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'use',
];

function isAsyncFunction(handler) {
  return typeof handler === 'function' && handler.constructor?.name === 'AsyncFunction';
}

function wrapAsyncHandler(handler) {
  if (!isAsyncFunction(handler) || handler.__noderouteAsyncWrapped) return handler;
  if (handler.length >= 4) return handler;

  const wrapped = function asyncRouteHandler(req, res, next) {
    return Promise.resolve(handler.call(this, req, res, next)).catch(next);
  };
  Object.defineProperty(wrapped, '__noderouteAsyncWrapped', { value: true });
  return wrapped;
}

function wrapRouteArg(arg) {
  if (Array.isArray(arg)) return arg.map(wrapRouteArg);
  return wrapAsyncHandler(arg);
}

function patchMethods(target) {
  if (!target || target.__noderouteRouteMethodsPatched) return;

  for (const method of ROUTE_METHODS) {
    if (typeof target[method] !== 'function') continue;
    const original = target[method];
    target[method] = function patchedRouteMethod(...args) {
      return original.apply(this, args.map(wrapRouteArg));
    };
  }

  Object.defineProperty(target, '__noderouteRouteMethodsPatched', { value: true });
}

function patchRouteFactory(target) {
  if (!target || typeof target.route !== 'function' || target.__noderouteRouteFactoryPatched) return;
  const originalRoute = target.route;
  target.route = function patchedRouteFactory(...args) {
    const route = originalRoute.apply(this, args);
    patchMethods(route);
    return route;
  };
  Object.defineProperty(target, '__noderouteRouteFactoryPatched', { value: true });
}

function patchRouterInstance(router) {
  patchMethods(router);
  patchRouteFactory(router);
  return router;
}

function installAsyncRouteHandlerWrapping(express) {
  if (!express || express.__noderouteAsyncRouteWrappingInstalled) return express;

  const originalRouter = express.Router;
  express.Router = function patchedRouterFactory(...args) {
    return patchRouterInstance(originalRouter.apply(this, args));
  };
  Object.assign(express.Router, originalRouter);

  patchMethods(express.application);
  patchRouteFactory(express.application);

  Object.defineProperty(express, '__noderouteAsyncRouteWrappingInstalled', { value: true });
  return express;
}

module.exports = {
  installAsyncRouteHandlerWrapping,
  wrapAsyncHandler,
};