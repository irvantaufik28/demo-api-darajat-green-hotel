export type CreateRoleBody = { name: string };
export type UpdateRolePermissionsBody = { permissionCodes: string[] };

export const roleIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

export const createRoleSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", minLength: 2, maxLength: 80 } },
};

export const updateRolePermissionsSchema = {
  type: "object",
  required: ["permissionCodes"],
  additionalProperties: false,
  properties: {
    permissionCodes: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
  },
};
