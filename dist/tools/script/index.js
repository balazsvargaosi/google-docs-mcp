import { register as createAppsScriptProject } from './createAppsScriptProject.js';
import { register as getAppsScriptContent } from './getAppsScriptContent.js';
import { register as updateAppsScriptContent } from './updateAppsScriptContent.js';
/**
 * Registers Apps Script project tools.
 *
 * These require the Apps Script API to be enabled per account at
 * https://script.google.com/home/usersettings and the script.projects OAuth scope.
 */
export function registerScriptTools(server) {
    createAppsScriptProject(server);
    getAppsScriptContent(server);
    updateAppsScriptContent(server);
}
