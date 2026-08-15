/**
 * Host (Node) half of the `codex-to-dsh-pet` surface plugin.
 *
 * Pure browser-surface plugin: the empty apply exists only so the plugin
 * appears in the host Loader / cordis roster. The actual pet renders from
 * `exports["./client"]`, discovered through the package.json `dsh.client`
 * declaration.
 */
function apply() {}

export { apply };
