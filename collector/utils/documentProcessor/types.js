/**
 * @typedef {object} DocumentProcessor
 * @property {string} id
 * @property {string[]} extensions
 * @property {(extension: string, filename?: string) => boolean} canProcess
 * @property {(context: {
 *   fullFilePath: string,
 *   filename: string,
 *   options?: object,
 *   metadata?: object
 * }) => Promise<{ success: boolean, reason: string|null, documents: object[] }>} process
 */

module.exports = {};
