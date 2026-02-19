/**
 * MAIN world content script - intercepts fetch() and XHR calls to Twitter's
 * GraphQL API and provides an active paginator for cursor-based fetching.
 *
 * Runs at document_start before Twitter's JS loads.
 * Self-contained IIFE - no ES module imports allowed in MAIN world.
 */
(function () {
  'use strict';

  // Broad pattern - match any GraphQL call containing Follower or Following
  const GRAPHQL_PATTERN = /\/i\/api\/graphql\/([^/]+)\/(Followers|Following|FollowersYouKnow|FollowingYouKnow|BlueVerifiedFollowers)/i;
  const MSG_TYPE = 'XPRTR_INTERCEPTED';
  const RATE_LIMIT_TYPE = 'XPRTR_RATE_LIMITED';
  const FETCH_CMD = 'XPRTR_FETCH_PAGE';
  const FETCH_RESULT = 'XPRTR_FETCH_RESULT';
  const RESEND_CMD = 'XPRTR_RESEND_INITIAL';

  const originalFetch = window.fetch;
  const requestTemplates = {};
  const cachedResponses = {}; // Cache last intercepted response per listType

  console.log('[xtractr] Interceptor loaded at', new Date().toISOString());

  // ---- Wrap fetch() ----

  window.fetch = async function (...args) {
    // Pre-extract request details BEFORE calling original fetch
    let url = '';
    let initObj = args[1] || {};
    let method = 'GET';
    let bodyStr = null;
    let requestObj = null;

    try {
      if (typeof args[0] === 'string') {
        url = args[0];
        method = (initObj.method || 'GET').toUpperCase();
        if (typeof initObj.body === 'string') bodyStr = initObj.body;
      } else if (args[0] instanceof Request) {
        requestObj = args[0];
        url = requestObj.url;
        method = (requestObj.method || 'GET').toUpperCase();
        if (!args[1]) initObj = { _request: requestObj };
        // For POST requests, clone and read body before it's consumed
        if (method !== 'GET' && method !== 'HEAD') {
          try {
            const clonedReq = requestObj.clone();
            bodyStr = await clonedReq.text();
          } catch (e) {
            console.warn('[xtractr] Could not read request body:', e.message);
          }
        }
      } else if (args[0]?.url) {
        url = args[0].url;
      }
    } catch (e) {
      console.warn('[xtractr] Error extracting request details:', e.message);
    }

    const match = url.match(GRAPHQL_PATTERN);

    const response = await originalFetch.apply(this, args);

    try {
      if (match) {
        const graphqlHash = match[1];
        const rawQueryType = match[2];
        const listType = normalizeListType(rawQueryType);
        console.log(`[xtractr] Intercepted fetch: ${listType} (${rawQueryType}) [${method}] hash=${graphqlHash}`, url.slice(0, 150));

        // Capture request template for replaying
        captureTemplate(listType, url, initObj, requestObj, method, bodyStr, graphqlHash, rawQueryType);

        if (response.status === 429) {
          console.log('[xtractr] Rate limited (429)');
          const retryAfter = response.headers.get('retry-after');
          postMsg(RATE_LIMIT_TYPE, { listType, retryAfter: retryAfter ? parseInt(retryAfter, 10) : null });
          return response;
        }

        const clone = response.clone();
        clone.json().then(json => {
          const errors = json?.errors;
          if (errors && errors.some(e =>
            (e.code === 88) || (e.message && e.message.toLowerCase().includes('rate limit'))
          )) {
            console.log('[xtractr] Rate limited (GraphQL error)');
            postMsg(RATE_LIMIT_TYPE, { listType, retryAfter: null });
            return;
          }

          // Log response structure for debugging
          logResponseStructure(json, listType);

          // Only cache primary query responses (not subtypes like BlueVerifiedFollowers)
          if (isPrimaryQueryType(rawQueryType)) {
            cachedResponses[listType] = { data: json, url };
          }

          console.log('[xtractr] Forwarding response data for', listType, '(raw:', rawQueryType + ')');
          postMsg(MSG_TYPE, { listType, data: json, url, rawQueryType });
        }).catch(err => {
          console.warn('[xtractr] Failed to parse response JSON:', err.message);
        });
      }
    } catch (err) {
      console.warn('[xtractr] Interceptor error:', err.message);
    }

    return response;
  };

  // ---- Also wrap XHR as fallback ----

  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (xhrMethod, xhrUrl, ...rest) {
    this._xtractrUrl = xhrUrl;
    this._xtractrMethod = xhrMethod;
    return origXHROpen.call(this, xhrMethod, xhrUrl, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...sendArgs) {
    const xhrUrl = this._xtractrUrl || '';
    const match = xhrUrl.match(GRAPHQL_PATTERN);

    if (match) {
      const rawQueryType = match[2];
      const listType = normalizeListType(rawQueryType);
      const xhrBody = typeof sendArgs[0] === 'string' ? sendArgs[0] : null;
      console.log(`[xtractr] Intercepted XHR: ${listType} (${rawQueryType}) [${this._xtractrMethod}]`, xhrUrl.slice(0, 150));

      captureTemplate(listType, xhrUrl, {}, null, this._xtractrMethod || 'GET', xhrBody, match[1], rawQueryType);

      this.addEventListener('load', () => {
        try {
          if (this.status === 429) {
            postMsg(RATE_LIMIT_TYPE, { listType, retryAfter: null });
            return;
          }
          const json = JSON.parse(this.responseText);
          const errors = json?.errors;
          if (errors && errors.some(e =>
            (e.code === 88) || (e.message && e.message.toLowerCase().includes('rate limit'))
          )) {
            postMsg(RATE_LIMIT_TYPE, { listType, retryAfter: null });
            return;
          }
          logResponseStructure(json, listType);
          // Only cache primary query responses (not subtypes like BlueVerifiedFollowers)
          if (isPrimaryQueryType(rawQueryType)) {
            cachedResponses[listType] = { data: json, url: xhrUrl };
          }
          console.log('[xtractr] Forwarding XHR response for', listType, '(raw:', rawQueryType + ')');
          postMsg(MSG_TYPE, { listType, data: json, url: xhrUrl, rawQueryType });
        } catch {}
      });
    }

    return origXHRSend.apply(this, sendArgs);
  };

  // ---- Helpers ----

  function normalizeListType(raw) {
    const lower = raw.toLowerCase();
    if (lower.includes('following')) return 'following';
    return 'followers';
  }

  // Primary query types whose templates should be preferred for pagination.
  // Subtypes (FollowersYouKnow, BlueVerifiedFollowers, etc.) return smaller
  // subsets and should not overwrite the main template.
  function isPrimaryQueryType(raw) {
    return /^(Followers|Following)$/i.test(raw);
  }

  function postMsg(type, payload) {
    window.postMessage({ type, payload }, '*');
  }

  function logResponseStructure(json, listType) {
    try {
      const topKeys = Object.keys(json || {});
      console.log(`[xtractr] Response for ${listType}: top keys =`, topKeys);

      if (json?.data) {
        const dataKeys = Object.keys(json.data);
        console.log(`[xtractr]   data keys =`, dataKeys);

        const user = json.data?.user;
        if (user) {
          const result = user?.result;
          if (result) {
            const resultKeys = Object.keys(result);
            console.log(`[xtractr]   data.user.result keys =`, resultKeys);

            const timeline = result?.timeline;
            if (timeline) {
              const tlKeys = Object.keys(timeline);
              console.log(`[xtractr]   timeline keys =`, tlKeys);

              const innerTl = timeline?.timeline;
              if (innerTl) {
                console.log(`[xtractr]   timeline.timeline keys =`, Object.keys(innerTl));
              }

              const instructions = innerTl?.instructions || timeline?.instructions;
              if (instructions) {
                console.log(`[xtractr]   instructions: ${instructions.length} items, types =`,
                  instructions.map(i => i.type || 'no-type'));
                for (const inst of instructions) {
                  if (inst.entries) {
                    const entryIds = inst.entries.slice(0, 5).map(e => e.entryId);
                    console.log(`[xtractr]   entries: ${inst.entries.length} total, first ids =`, entryIds);
                  }
                }
              } else {
                console.warn('[xtractr]   NO instructions found in timeline');
              }
            } else {
              console.warn('[xtractr]   NO timeline in data.user.result');
            }
          }
        }
      }
    } catch (e) {
      console.warn('[xtractr] Error logging structure:', e.message);
    }
  }

  // ---- Capture request template ----

  function captureTemplate(listType, url, init, requestObj, method, bodyStr, graphqlHash, rawQueryType) {
    // Don't let subtype queries overwrite the primary template
    if (requestTemplates[listType] && !isPrimaryQueryType(rawQueryType)) {
      console.log('[xtractr] Keeping existing template for', listType, '- skipping subtype:', rawQueryType);
      return;
    }

    try {
      const parsedUrl = new URL(url, location.origin);

      // Try URL query params first (GET requests)
      let variablesStr = parsedUrl.searchParams.get('variables');
      let featuresStr = parsedUrl.searchParams.get('features');
      let fieldTogglesStr = parsedUrl.searchParams.get('fieldToggles');
      let capturedMethod = (method || 'GET').toUpperCase();

      // For POST requests, parse variables from request body
      if (!variablesStr && bodyStr) {
        try {
          const bodyJson = JSON.parse(bodyStr);
          console.log('[xtractr] POST body keys:', Object.keys(bodyJson));

          if (bodyJson.variables) {
            variablesStr = typeof bodyJson.variables === 'string'
              ? bodyJson.variables
              : JSON.stringify(bodyJson.variables);
          }
          if (bodyJson.features && !featuresStr) {
            featuresStr = typeof bodyJson.features === 'string'
              ? bodyJson.features
              : JSON.stringify(bodyJson.features);
          }
          if (bodyJson.fieldToggles && !fieldTogglesStr) {
            fieldTogglesStr = typeof bodyJson.fieldToggles === 'string'
              ? bodyJson.fieldToggles
              : JSON.stringify(bodyJson.fieldToggles);
          }
        } catch (e) {
          console.warn('[xtractr] Could not parse POST body:', e.message);
        }
      }

      // Also try init.body as fallback
      if (!variablesStr && init?.body && typeof init.body === 'string') {
        try {
          const bodyJson = JSON.parse(init.body);
          if (bodyJson.variables) {
            variablesStr = typeof bodyJson.variables === 'string'
              ? bodyJson.variables
              : JSON.stringify(bodyJson.variables);
          }
          if (bodyJson.features && !featuresStr) {
            featuresStr = typeof bodyJson.features === 'string'
              ? bodyJson.features
              : JSON.stringify(bodyJson.features);
          }
        } catch {}
      }

      if (!variablesStr) {
        console.warn('[xtractr] No variables found in URL or body. Skipping.',
          'URL params:', [...parsedUrl.searchParams.keys()],
          'Method:', capturedMethod,
          'Has body:', !!bodyStr,
          'Body preview:', bodyStr ? bodyStr.slice(0, 100) : 'none');
        return;
      }

      const variables = typeof variablesStr === 'object' ? variablesStr : JSON.parse(variablesStr);
      const headers = extractHeaders(init, requestObj);

      console.log('[xtractr] Captured template for', listType,
        '| method:', capturedMethod,
        '| userId:', variables.userId,
        '| count:', variables.count,
        '| headers:', Object.keys(headers).length,
        '| hash:', graphqlHash);

      requestTemplates[listType] = {
        baseUrl: parsedUrl.origin + parsedUrl.pathname,
        variables,
        features: featuresStr || '',
        fieldToggles: fieldTogglesStr || '',
        headers,
        method: capturedMethod,
        graphqlHash,
        capturedAt: Date.now(),
      };
    } catch (err) {
      console.warn('[xtractr] Template capture failed:', err.message, err.stack);
    }
  }

  function extractHeaders(init, requestObj) {
    const headers = {};

    if (init && init.headers) {
      mergeHeaders(headers, init.headers);
    }
    if (requestObj instanceof Request && requestObj.headers) {
      mergeHeaders(headers, requestObj.headers);
    }
    if (init?._request instanceof Request && init._request.headers) {
      mergeHeaders(headers, init._request.headers);
    }

    // Ensure critical headers exist
    if (!headers['authorization']) {
      headers['authorization'] = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
    }
    if (!headers['x-csrf-token']) {
      headers['x-csrf-token'] = getCsrfToken();
    }

    return headers;
  }

  function mergeHeaders(target, source) {
    try {
      if (source instanceof Headers) {
        source.forEach((value, key) => { target[key] = value; });
      } else if (Array.isArray(source)) {
        for (const [key, value] of source) { target[key] = value; }
      } else if (typeof source === 'object') {
        Object.assign(target, source);
      }
    } catch {}
  }

  function getCsrfToken() {
    const match = document.cookie.match(/ct0=([^;]+)/);
    return match ? match[1] : '';
  }

  // ---- Active paginator: fetch a page on demand ----

  async function fetchPage(listType, cursor) {
    const template = requestTemplates[listType];
    if (!template) {
      console.warn('[xtractr] No template for', listType,
        '- available:', Object.keys(requestTemplates));
      return { error: 'No request template captured. Scroll the page or reload to trigger a request.' };
    }

    try {
      const variables = { ...template.variables };
      if (cursor) {
        variables.cursor = cursor;
      }
      if (!variables.count) {
        variables.count = 20;
      }

      const usePost = template.method === 'POST';
      const headers = { ...template.headers };
      headers['x-csrf-token'] = getCsrfToken();

      let fetchUrl;
      let fetchInit;

      if (usePost) {
        // POST: variables in JSON body
        fetchUrl = template.baseUrl;
        const body = { variables };
        if (template.features) {
          try { body.features = JSON.parse(template.features); } catch { body.features = template.features; }
        }
        if (template.fieldToggles) {
          try { body.fieldToggles = JSON.parse(template.fieldToggles); } catch { body.fieldToggles = template.fieldToggles; }
        }
        headers['content-type'] = 'application/json';
        fetchInit = {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(body),
        };
        console.log(`[xtractr] Fetching page [POST]: cursor=${cursor ? cursor.slice(0, 20) + '...' : 'null'}`);
      } else {
        // GET: variables in URL params
        const params = new URLSearchParams();
        params.set('variables', JSON.stringify(variables));
        if (template.features) params.set('features', template.features);
        if (template.fieldToggles) params.set('fieldToggles', template.fieldToggles);
        fetchUrl = `${template.baseUrl}?${params.toString()}`;
        fetchInit = {
          method: 'GET',
          headers,
          credentials: 'include',
        };
        console.log(`[xtractr] Fetching page [GET]: cursor=${cursor ? cursor.slice(0, 20) + '...' : 'null'}`);
      }

      const response = await originalFetch(fetchUrl, fetchInit);
      console.log(`[xtractr] Fetch response: ${response.status}`);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return { rateLimited: true, retryAfter: retryAfter ? parseInt(retryAfter, 10) : null };
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[xtractr] Fetch failed: HTTP ${response.status}`, errText.slice(0, 300));
        return { error: `HTTP ${response.status}` };
      }

      const json = await response.json();
      logResponseStructure(json, listType);

      const errors = json?.errors;
      if (errors && errors.length > 0) {
        console.warn('[xtractr] GraphQL errors:', errors.map(e => e.message).join('; '));
        if (errors.some(e => (e.code === 88) || (e.message && e.message.toLowerCase().includes('rate limit')))) {
          return { rateLimited: true, retryAfter: null };
        }
        return { error: errors[0].message };
      }

      return { data: json };
    } catch (err) {
      console.warn('[xtractr] Fetch error:', err.message);
      return { error: err.message };
    }
  }

  // ---- Listen for commands from the content script ----

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    // Fetch page command
    if (event.data?.type === FETCH_CMD) {
      const { listType, cursor, requestId } = event.data.payload;
      console.log(`[xtractr] Received fetch command: ${listType}, cursor=${cursor ? 'yes' : 'null'}, requestId=${requestId}`);

      const result = await fetchPage(listType, cursor);
      postMsg(FETCH_RESULT, { requestId, ...result });

      if (result.data) {
        postMsg(MSG_TYPE, { listType, data: result.data, url: location.href });
      }
      if (result.rateLimited) {
        postMsg(RATE_LIMIT_TYPE, { listType, retryAfter: result.retryAfter });
      }
    }

    // Resend cached initial data (content script loaded late)
    if (event.data?.type === RESEND_CMD) {
      const requestedType = event.data.payload?.listType;
      console.log(`[xtractr] Resend requested for: ${requestedType || 'all'}`,
        '| cached:', Object.keys(cachedResponses),
        '| templates:', Object.keys(requestTemplates));

      if (requestedType && cachedResponses[requestedType]) {
        const cached = cachedResponses[requestedType];
        console.log('[xtractr] Resending cached data for', requestedType);
        postMsg(MSG_TYPE, { listType: requestedType, data: cached.data, url: cached.url });
      } else {
        for (const [lt, cached] of Object.entries(cachedResponses)) {
          console.log('[xtractr] Resending cached data for', lt);
          postMsg(MSG_TYPE, { listType: lt, data: cached.data, url: cached.url });
        }
      }

      postMsg('XPRTR_TEMPLATE_STATUS', {
        templates: Object.keys(requestTemplates),
        cached: Object.keys(cachedResponses),
      });
    }
  });

  console.log('[xtractr] Interceptor ready, watching for GraphQL traffic');
})();
