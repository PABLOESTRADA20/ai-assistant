let e = new Error("Modulo no disponible en Cloudflare Workers");
e.__shimError = true;
throw e;
