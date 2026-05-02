import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { projectCollaborators, projects, users } from "../../drizzle/schema";

export const shareRouter = router({
  // Invite a collaborator to a project
  invite: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      inviteEmail: z.string().email().optional(),
      role: z.enum(["viewer", "editor"]).default("viewer"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Verify ownership
      const project = await db.select().from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id)))
        .limit(1);
      if (!project[0]) throw new Error("Projet introuvable ou accès refusé");

      // Generate unique token (expires in 7 days)
      const inviteToken = nanoid(32);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.insert(projectCollaborators).values({
        projectId: input.projectId,
        ownerId: ctx.user.id,
        inviteEmail: input.inviteEmail || null,
        inviteToken,
        role: input.role,
        status: "pending",
        expiresAt,
      });

      return { inviteToken, expiresAt };
    }),

  // Accept an invitation via token
  accept: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      if (!ctx.user) throw new Error("Connexion requise pour accepter l'invitation");

      const invite = await db.select().from(projectCollaborators)
        .where(eq(projectCollaborators.inviteToken, input.token))
        .limit(1);

      if (!invite[0]) throw new Error("Invitation introuvable");
      if (invite[0].status === "revoked") throw new Error("Cette invitation a été révoquée");
      if (invite[0].status === "accepted") throw new Error("Invitation déjà acceptée");
      if (invite[0].expiresAt && invite[0].expiresAt < new Date()) throw new Error("Invitation expirée");
      if (invite[0].ownerId === ctx.user.id) throw new Error("Vous êtes déjà propriétaire de ce projet");

      await db.update(projectCollaborators)
        .set({
          collaboratorId: ctx.user.id,
          status: "accepted",
          acceptedAt: new Date(),
        })
        .where(eq(projectCollaborators.id, invite[0].id));

      return { projectId: invite[0].projectId, role: invite[0].role };
    }),

  // List collaborators for a project
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Must be owner or collaborator
      const project = await db.select().from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project[0]) throw new Error("Projet introuvable");

      const isOwner = project[0].userId === ctx.user.id;
      if (!isOwner) {
        const collab = await db.select().from(projectCollaborators)
          .where(and(
            eq(projectCollaborators.projectId, input.projectId),
            eq(projectCollaborators.collaboratorId, ctx.user.id),
            eq(projectCollaborators.status, "accepted"),
          ))
          .limit(1);
        if (!collab[0]) throw new Error("Accès refusé");
      }

      const collabs = await db.select().from(projectCollaborators)
        .where(eq(projectCollaborators.projectId, input.projectId));

      // Enrich with collaborator names
      const enriched = await Promise.all(collabs.map(async (c) => {
        let collaboratorName: string | null = null;
        if (c.collaboratorId) {
          const u = await db.select({ name: users.name, email: users.email })
            .from(users).where(eq(users.id, c.collaboratorId)).limit(1);
          collaboratorName = u[0]?.name || u[0]?.email || null;
        }
        return { ...c, collaboratorName };
      }));

      return enriched;
    }),

  // Revoke an invitation or collaborator
  revoke: protectedProcedure
    .input(z.object({ collaboratorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const collab = await db.select().from(projectCollaborators)
        .where(eq(projectCollaborators.id, input.collaboratorId))
        .limit(1);
      if (!collab[0]) throw new Error("Collaborateur introuvable");
      if (collab[0].ownerId !== ctx.user.id) throw new Error("Accès refusé");

      await db.update(projectCollaborators)
        .set({ status: "revoked" })
        .where(eq(projectCollaborators.id, input.collaboratorId));

      return { success: true };
    }),

  // Get project info from invite token (public — for preview before accepting)
  previewInvite: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const invite = await db.select().from(projectCollaborators)
        .where(eq(projectCollaborators.inviteToken, input.token))
        .limit(1);
      if (!invite[0]) throw new Error("Invitation introuvable");

      const project = await db.select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects).where(eq(projects.id, invite[0].projectId)).limit(1);

      const owner = await db.select({ name: users.name })
        .from(users).where(eq(users.id, invite[0].ownerId)).limit(1);

      return {
        projectName: project[0]?.name || "Projet",
        ownerName: owner[0]?.name || "Un utilisateur",
        role: invite[0].role,
        status: invite[0].status,
        expiresAt: invite[0].expiresAt,
      };
    }),

  // List shared projects (projects where user is a collaborator)
  sharedWithMe: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];

      const collabs = await db.select().from(projectCollaborators)
        .where(and(
          eq(projectCollaborators.collaboratorId, ctx.user.id),
          eq(projectCollaborators.status, "accepted"),
        ));

      const result = await Promise.all(collabs.map(async (c) => {
        const project = await db.select().from(projects)
          .where(eq(projects.id, c.projectId)).limit(1);
        const owner = await db.select({ name: users.name })
          .from(users).where(eq(users.id, c.ownerId)).limit(1);
        return {
          ...project[0],
          collaboratorRole: c.role,
          ownerName: owner[0]?.name || "Inconnu",
        };
      }));

      return result.filter(Boolean);
    }),
});
