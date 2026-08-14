/**
 * The lint script and its plugins were both in package.json; the config was
 * never written, so `npm run lint` failed with "couldn't find a configuration
 * file" and nothing was ever checked.
 *
 * The rule that earns its place here is react-hooks/exhaustive-deps. A stale
 * or over-eager dependency array is invisible in review and expensive at
 * runtime — an inline callback named as a dependency of an effect that loads
 * a 3D model rebuilt the entire scene on every render, and that shipped.
 */
module.exports = {
    root: true,
    env: { browser: true, es2022: true },
    extends: [
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
    ],
    ignorePatterns: ['dist', 'node_modules', 'public/draco', 'public/basis'],
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    settings: { react: { version: '18.2' } },
    plugins: ['react-refresh'],
    rules: {
        'react-refresh/only-export-components': 'off',
        // Components take a documented prop contract; enforcing propTypes on
        // an internal app adds ceremony without catching anything the callers
        // do not already make obvious.
        'react/prop-types': 'off',
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        // Empty catch blocks here are deliberate and commented — a failed
        // localStorage write or an already-stopped audio node has nothing to
        // handle — so the rule is narrowed rather than silenced everywhere.
        'no-empty': ['error', { allowEmptyCatch: true }],
        // Purely typographic. Raw quotes and apostrophes in JSX text render
        // correctly; the prose on the standing pages is full of them and
        // rewriting it as &rsquo; makes it harder to read in source than it
        // ever was on screen.
        'react/no-unescaped-entities': 'off',
    },
};
