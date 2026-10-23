import { z } from 'zod'
import { hhmm, trimmedString, userRole, uuid } from './common'

const email = z.string().trim().toLowerCase().email().max(254)
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === '' || v.replace(/\D/g, '').length >= 10, 'Phone number must have at least 10 digits')

const workHours = {
  country: z.string().trim().max(2).nullish(),
  timeZone: z.string().trim().max(64).nullish(),
  workDayStart: hhmm.nullish(),
  workDayEnd: hhmm.nullish(),
}

export const createUserSchema = z.object({
  email,
  name: trimmedString(120).optional(),
  role: userRole.default('EMPLOYEE'),
  departmentId: uuid.nullish(),
  reportsToId: uuid.nullish(),
  ...workHours,
})

export const updateUserSchema = z.object({
  email: email.optional(),
  name: trimmedString(120).optional(),
  role: userRole.optional(),
  departmentId: uuid.nullish(),
  reportsToId: uuid.nullish(),
  isActive: z.boolean().optional(),
  kekaEmployeeId: z.string().trim().max(64).nullish(),
  ...workHours,
})

/** Self-service profile: identity/contact/timezone only. Manager + department are admin/onboarding only. */
export const updateProfileSchema = z.object({
  name: trimmedString(120).optional(),
  phone: phone.nullish(),
  title: z.string().trim().max(120).nullish(),
  bio: z.string().trim().max(2000).nullish(),
  ...workHours,
})

export const onboardingSchema = z.object({
  departmentId: uuid.nullish(),
  reportsToId: uuid,
})

export const departmentSchema = z.object({
  name: trimmedString(80),
})

export const importUsersSchema = z.object({
  users: z
    .array(
      z.object({
        name: trimmedString(120),
        email,
        role: z.string().trim().optional(),
        department: z.string().trim().max(80).optional(),
        reportsTo: z.string().trim().toLowerCase().optional(),
        title: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(30).optional(),
      })
    )
    .min(1)
    .max(1000),
})
