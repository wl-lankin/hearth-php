// Downloads from slow mirrors (archive.mariadb.org) drop now and then: a network error is tried
// again, an HTTP error (it carries `status`) is not.

/** Runs `run` up to `attempts` times, waiting `wait` ms more before each new try. */
export async function retrying(run, { attempts = 3, wait = 5000 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (e) {
      if (e.status !== undefined) throw e;
      if (attempt >= attempts) {
        // fetch says only "fetch failed"; the reason is in its cause.
        if (e.cause?.message) e.message = `${e.message} (${e.cause.message})`;
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, wait * attempt));
    }
  }
}
