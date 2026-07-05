const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

// Validator berbasis JSON Schema resmi (firmware/shared_protocol/payload_schema.json)
// agar firmware, worker, dan API berbagi satu sumber kebenaran.
function loadSharedSchema() {
  const candidates = [
    process.env.SHARED_PROTOCOL_SCHEMA,
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "firmware",
      "shared_protocol",
      "payload_schema.json",
    ),
    "/shared_protocol/payload_schema.json",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      // Drop $schema (draft-2020-12) supaya AJV default (draft-07) tidak meta-validate.
      // Konstruk yang dipakai (type, $ref, $defs, pattern, enum) kompatibel.
      delete parsed.$schema;
      return parsed;
    }
  }
  throw new Error(
    `payload_schema.json tidak ditemukan. Coba set SHARED_PROTOCOL_SCHEMA. Cari di: ${candidates.join(", ")}`,
  );
}

function buildValidators() {
  const schema = loadSharedSchema();
  const ajv = new Ajv({ allErrors: true, strict: false });

  // Daftarkan parent dulu supaya $ref ke #/$defs/deviceId, hexNonce, hexTag,
  // hexCipher dari sub-schema bisa diresolve.
  ajv.addSchema(schema, "shared_protocol");

  const validateEnvelope = ajv.getSchema(
    "shared_protocol#/$defs/encryptedPayload",
  );
  const validateAck = ajv.getSchema("shared_protocol#/$defs/ackPayload");
  const validateStatus = ajv.getSchema("shared_protocol#/$defs/statusPayload");

  // Format batch: device_id + array samples (10 sampel per pesan, tiap detik).
  // Kunci pendek dipakai firmware untuk hemat ukuran payload MQTT.
  const plainTelemetrySchema = {
    type: "object",
    additionalProperties: true,
    required: ["device_id", "samples"],
    properties: {
      device_id: { type: "string", minLength: 3 },
      samples: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          required: ["ts", "v", "i", "p", "e", "f", "pf", "alarm"],
          properties: {
            ts:    { type: "integer", minimum: 1 },
            v:     { type: "number" },
            i:     { type: "number" },
            p:     { type: "number" },
            e:     { type: "number" },
            f:     { type: "number" },
            pf:    { type: "number" },
            alarm: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  };
  const validatePlainTelemetry = ajv.compile(plainTelemetrySchema);

  const dashboardCommandSchema = {
    type: "object",
    additionalProperties: false,
    required: ["device_id", "command"],
    properties: {
      device_id: { type: "string", minLength: 3 },
      command: { type: "string", minLength: 1 },
      command_id: { type: "string", minLength: 1, maxLength: 64 },
      issued_by: { type: "string", maxLength: 64 },
    },
  };
  const validateDashboardCommand = ajv.compile(dashboardCommandSchema);

  function wrap(validator) {
    return function check(payload) {
      const ok = validator(payload);
      if (ok) return { ok: true };
      const reason = (validator.errors || [])
        .map((err) => `${err.instancePath || "/"} ${err.message}`)
        .join("; ");
      return { ok: false, reason };
    };
  }

  return {
    validateEncryptedEnvelope: wrap(validateEnvelope),
    validateAck: wrap(validateAck),
    validateStatus: wrap(validateStatus),
    validatePlainTelemetry: wrap(validatePlainTelemetry),
    validateDashboardCommand: wrap(validateDashboardCommand),
  };
}

module.exports = { buildValidators };
