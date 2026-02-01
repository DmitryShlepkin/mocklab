# Mocklab

Codeless mock server with file-based routing.\
No code, just JSON files.\
Mock your API quick.

## Install

1. Install node.js https://nodejs.org/en/download.

2. Create node.js project.
```
npm init
```

3. Install Mocklab in your project.
```
npm install mocklab --save-dev
```

4. Add script to your package.json
```json
  "scripts": {
    "mock": "mocklab"
  }
```

5. Create mocks folder.
```
mkdir mocks
```

## Configure (Optional)

Create mock.conf
```json
{
  "host": "localhost",
  "port": 3232,
  "overlay": "test",
  "historyLimit": 100
}
```
Configuration options:

- `host` - Server host (default: localhost)
- `port` - Server port (default: 3232)
- `overlay` - Active overlay name (default: none)
- `historyLimit` - Number of requests to keep in history (default: `100`)

If `mock.conf` doesn't exist, defaults to `localhost:3232` with no overlay.

## Run Server

```
npm run mock
```

## How to Use

For URL `GET /signup` (no query params):
1. Priority 1: `mocks/signup/index.json` (exact match)
2. Priority 2: `mocks/signup.json` (file match)

For URL `GET /signup/test` (path segment):
1. Priority 1: `mocks/signup/test/index.json`.
2. Priority 2: `mocks/signup/test.json`.
3. Priority 3: `mocks/signup/[*].json` (wildcard).

For URL `GET /signup?id` (query param):
1. Priority 2: `mocks/signup/[id].json` (any id value) ← Uses this.
2. Priority 3: `mocks/signup/index.json` (fallback).

For URL `GET /signup?id=5` (with specific query param value):
1. Priority 1: `mocks/signup/[id=5].json` (exact param value match) ← Uses this if exists.
2. Priority 2: `mocks/signup/[id].json` (param name match, any value).
3. Priority 3: `mocks/signup/index.json` (fallback).
4. Priority 4: `mocks/signup.json` (file fallback).

#### File Naming Convention
The URL stays the same, but the filename determines the response behavior:\
`{name}-[method-{method}]-[delay{delay(ms)}]-[status-{code}].json`

Examples: 

- `auth.json` → GET /auth returns immediately with status 200
- `auth-method-post.json` → POST /auth returns with status 200
- `auth-delay-500.json` → GET /auth waits 500ms, returns status 200
- `auth-status-404.json` → GET /auth returns immediately with status 404
- `auth-method-post-delay-500.json` → POST /auth waits 500ms, returns status 200
- `auth-method-post-delay-500-status-201`.json → POST /auth waits 500ms, returns status 201
- `auth-delay-1000-status-201.json` → GET /auth waits 1s, returns status 201

#### Supported HTTP methods:

- `GET` (default if no method specified)
- `POST`
- `PUT`
- `DELETE`
- `PATCH`

#### Validations:

- Delay: Maximum 10 minutes (600000ms) - longer values are capped.
- Status: Must be valid HTTP status (100-599) - invalid values default to 200.

#### Disable/Enable mocks

Use underscore prefix for templates or inactive mocks:\
`_auth-error-template.json`

## Overlays

Overlays allow you to override specific mocks for different testing scenarios without modifying your main mock files.

#### How overlays work:

1. Create an `overlays/` folder next to your `mocks/` folder.
2. Inside `overlays/`, create subfolders for each scenario (e.g., user-error, test, slow-network)
3. Add mock files with the same structure as your `mocks/` folder.
4. Activate an overlay via command line or config.

Priority: `overlays/{overlay-name}/` → `mocks/`

#### Usage:

```
npm run mock -- --overlay=user-error
```
For url `GET /auth` mock server will check:\
Priority: `overlays/user-error/auth.json` then `mocks/auth.json`
