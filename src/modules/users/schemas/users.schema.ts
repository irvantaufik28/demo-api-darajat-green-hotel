export type CreateUserBody = {
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  roleId: string;
  password: string;
  isActive: boolean;
};

export type UserStatusBody = { isActive: boolean };

const uuid = { type: "string", format: "uuid" };

export const userIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
};

export const createUserSchema = {
  type: "object",
  required: ["name", "email", "roleId", "password", "isActive"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    email: { type: "string", minLength: 3, maxLength: 255 },
    username: { type: ["string", "null"], maxLength: 80 },
    phone: { type: ["string", "null"], maxLength: 40 },
    roleId: uuid,
    password: { type: "string", minLength: 5, maxLength: 1024 },
    isActive: { type: "boolean" },
  },
};

export const userStatusSchema = {
  type: "object",
  required: ["isActive"],
  additionalProperties: false,
  properties: { isActive: { type: "boolean" } },
};
