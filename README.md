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

#### File Naming Convention

Filename determines the response behavior:\
`{name}-[method-{method}]-[delay{delay(ms)}]-[status-{code}].json`

Name before file extension is used for url:\
`auth.json` → `/auth`

When a file is placed inside a folder, the folder name becomes the first segment of the URL:\
`signin/email.json` → `/signin/email`

Use `index` to define response for parent segment of URL:\
`signin/index.json` → `/signin`

That's how you can't have response for both segments of URL:\
`signin/index.json` → `/signin`\
`signin/email.json` → `/signin/email`

#### Wildcard

Use [*] as filename to define wildcard:\
`signup/[*].json` → `/signin/email`\
`signup/[*].json` → `/signin/oauth`

#### Get params

Use [id] as filename to respond to specific get params:\
`signup/[email].json` → `/signin/?email` (With any value).\
`signup/[oauth].json` → `/signin/?oauth` (With any value).

#### Get params with specific value

Use [id=value] as filename to respond to get params with specific values:\
`signup/[id=1].json` → `/signin/?id=1`\
`signup/[id=2].json` → `/signin/?id=2` 

#### HTTP method

Add `method-{method-name}` to filename to define URL method:\
`auth-method-post.json`  → `/auth.json` will response only to `POST` requests.\
\
Supported HTTP methods:

- `GET` (default if no method specified)
- `POST`
- `PUT`
- `DELETE`
- `PATCH`

#### HTTP Status Code

Add `status-{status-code}` to filename to define HTTP Status code:
`auth-status-404.json`  → `/auth.json` will respond with a 404 status.

- Status: Must be valid HTTP status (100-599) - invalid values default to 200.

#### Response delay

Add `delay-{delay-ms}` to filename, to define response delay:
`auth-delay-2000.json`  → `/auth.json` will respond after 2s delay.

- Delay: Maximum 10 minutes (600000ms) - longer values are capped.

#### Disable/Enable mocks

Use underscore prefix for templates or inactive mocks:\
`_auth-error-template.json`

#### Examples

- `auth.json` → GET /auth returns immediately with status 200
- `auth-method-post.json` → POST /auth returns with status 200
- `auth-delay-500.json` → GET /auth waits 500ms, returns status 200
- `auth-status-404.json` → GET /auth returns immediately with status 404
- `auth-method-post-delay-500.json` → POST /auth waits 500ms, returns status 200
- `auth-method-post-delay-500-status-201`.json → POST /auth waits 500ms, returns status 201
- `auth-delay-1000-status-201.json` → GET /auth waits 1s, returns status 201

#### Priority

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

## Overlays

Overlays allow you to override specific mocks for different testing scenarios without modifying your main mock files.

#### How overlays work:

1. Create an `overlays/` folder next to your `mocks/` folder.
2. Inside `overlays/`, create subfolders for each scenario (e.g., user-error, test, auth-error)
3. Add mock files with the same structure as your `mocks/` folder.
4. Activate an overlay via command line or config.

#### Usage:

```
npm run mock -- --overlay=user-error
```
For url `GET /auth` mock server will check:\
1. `overlays/user-error/auth.json` 
2. `mocks/auth.json`
