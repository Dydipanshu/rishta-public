export function withTimeout<T>(work: PromiseLike<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
