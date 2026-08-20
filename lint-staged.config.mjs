const config = {
  '**/*.{ts,tsx,js,mjs,cjs}': ['prettier --write', 'git add'],
  '**/*.{json,md,yml,yaml,css,scss}': ['prettier --write', 'git add'],
};

export default config;
