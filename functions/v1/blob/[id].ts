// Pages Function for /v1/blob/:id -- thin method wrappers over the framework-free data-path logic in
// _shared/blob.ts, which owns id-validation, the 1 MiB cap, and version stamping. Pages file-routing
// dispatches the method, so there is no manual GET/PUT/405 branching here.

import { readBlob, writeBlob, type Env } from "../../_shared/blob"

export const onRequestGet: PagesFunction<Env> = ({ params, env }) => readBlob(env, String(params.id))

export const onRequestPut: PagesFunction<Env> = ({ params, env, request }) =>
    writeBlob(env, String(params.id), request)
