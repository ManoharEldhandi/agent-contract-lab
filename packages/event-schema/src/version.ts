/** Protocol and schema version constants shared by supervisor and clients. */

export const SCHEMA_VERSION = 1 as const;

/** Current API version advertised by the supervisor, as MAJOR.MINOR. */
export const API_VERSION = '1.0' as const;

/** API major version that current clients understand. */
export const SUPPORTED_API_MAJOR = 1 as const;
