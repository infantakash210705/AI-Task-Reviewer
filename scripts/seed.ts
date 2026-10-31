import mongoose from "mongoose";
import { connectDB } from "../lib/db";
import { Assignment, EmailLog, Intern, Meeting, Review, Submission, Task, User } from "../lib/models";

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (process.env.NODE_ENV !== "development" || process.env.SEED_DEVELOPMENT_DATA !== "true" || !uri) {
    throw new Error("Seed refused: require NODE_ENV=development, SEED_DEVELOPMENT_DATA=true, and MONGODB_URI.");
  }
  const databaseName = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "http:")).pathname.slice(1).split("?")[0];
  if (!databaseName || /production/i.test(databaseName)) throw new Error("Seed refused: database name must be present and must not contain 'production'.");
  await connectDB();

  const adminUser = await User.findOneAndUpdate({ providerAccountId: "seed-google-admin" }, {
    $setOnInsert: { name: "Dev Administrator", email: "admin@example.test", normalizedEmail: "admin@example.test", role: "ADMIN", providerAccountId: "seed-google-admin", isActive: true, image: "" },
  }, { upsert: true, new: true });
  const taskInputs = [
    { slug: "seed-build-responsive-portfolio", title: "Build a responsive portfolio", category: "Frontend", difficulty: "BEGINNER" },
    { slug: "seed-create-rest-api", title: "Create a REST API", category: "Backend", difficulty: "INTERMEDIATE" },
    { slug: "seed-dashboard-accessibility-review", title: "Review dashboard accessibility", category: "Quality", difficulty: "BEGINNER" },
  ];
  const internInputs = [
    { internCode: "SEED-INT-001", name: "Avery Morgan", email: "avery.morgan@example.test", department: "Product", internshipTitle: "Product Intern" },
    { internCode: "SEED-INT-002", name: "Jordan Lee", email: "jordan.lee@example.test", department: "Engineering", internshipTitle: "Software Intern" },
    { internCode: "SEED-INT-003", name: "Casey Patel", email: "casey.patel@example.test", department: "Design", internshipTitle: "Design Intern" },
  ];
  const interns = [];
  for (const input of internInputs) {
    const user = await User.findOneAndUpdate({ providerAccountId: `seed-google-${input.internCode}` }, {
      $setOnInsert: { name: input.name, email: input.email, normalizedEmail: input.email, role: "INTERN", providerAccountId: `seed-google-${input.internCode}`, isActive: true, image: "" },
    }, { upsert: true, new: true });
    const intern = await Intern.findOneAndUpdate({ userId: user._id }, {
      $setOnInsert: { userId: user._id, internCode: input.internCode, department: input.department, internshipTitle: input.internshipTitle, startDate: new Date("2026-09-01"), expectedEndDate: new Date("2026-12-01"), status: "ACTIVE" },
    }, { upsert: true, new: true });
    interns.push(intern);
  }
  const tasks = [];
  for (const input of taskInputs) {
    const task = await Task.findOneAndUpdate({ slug: input.slug }, {
      $setOnInsert: {
        ...input, shortDescription: "Fictional development seed record.", fullDescription: "Development-only example task. Replace with a real brief before assigning it in production.",
        requiredSkills: ["HTML", "CSS"], requirements: ["Implement the described experience."], acceptanceCriteria: ["Build passes.", "Layout works on mobile."],
        expectedDeliverables: ["Source code"], estimatedDuration: 10, status: "ACTIVE",
        createdBy: adminUser._id,
      },
    }, { upsert: true, new: true });
    tasks.push(task);
  }
  const assignments = [];
  for (const [index, task] of tasks.entries()) {
    const intern = interns[index];
    const assignment = await Assignment.findOneAndUpdate({ internId: intern._id, taskId: task._id }, {
      $setOnInsert: {
        internId: intern._id, taskId: task._id, assignedBy: adminUser._id, dueDate: new Date(Date.now() + (index + 4) * 86400000),
        status: index === 0 ? "IN_PROGRESS" : "ASSIGNED", progress: index === 0 ? 35 : 0, assignedAt: new Date(),
        taskSnapshot: {
          title: task.title, shortDescription: task.shortDescription, fullDescription: task.fullDescription,
          category: task.category, difficulty: task.difficulty, requiredSkills: task.requiredSkills,
          requirements: task.requirements, acceptanceCriteria: task.acceptanceCriteria,
          expectedDeliverables: task.expectedDeliverables, estimatedDuration: task.estimatedDuration,
        },
      },
    }, { upsert: true, new: true });
    assignments.push(assignment);
  }
  const assignment = assignments[0];
  const submission = await Submission.findOneAndUpdate({ assignmentId: assignment._id, version: 1 }, {
    $setOnInsert: {
      assignmentId: assignment._id, internId: interns[0]._id, submissionType: "REPOSITORY_URL",
      repositoryUrl: "https://example.test/fictional-portfolio", version: 1, description: "Fictional seed submission.",
      submittedAt: new Date(), status: "SUBMITTED",
    },
  }, { upsert: true, new: true });
  await Assignment.findByIdAndUpdate(assignment._id, { $set: { currentSubmissionId: submission._id, status: "IN_REVIEW" } });
  await Submission.findByIdAndUpdate(submission._id, { $set: { status: "IN_REVIEW" } });
  await Review.findOneAndUpdate({ submissionId: submission._id }, {
    $setOnInsert: {
      assignmentId: assignment._id, submissionId: submission._id, reviewerType: "HUMAN",
      summary: "Fictional seed review record.", findings: ["Example finding"], recommendations: ["Example recommendation"], result: "IN_REVIEW",
    },
  }, { upsert: true });
  await Meeting.findOneAndUpdate({ assignmentId: assignment._id, meetingType: "REVIEW" }, {
    $setOnInsert: { assignmentId: assignment._id, meetingType: "REVIEW", scheduledAt: new Date(Date.now() + 3 * 86400000), durationMinutes: 30, status: "SCHEDULED", meetingUrl: "" },
  }, { upsert: true });
  await EmailLog.findOneAndUpdate({ recipient: "seed@example.test", templateType: "SEED_PLACEHOLDER" }, {
    $setOnInsert: { recipient: "seed@example.test", templateType: "SEED_PLACEHOLDER", status: "PENDING", errorMessage: "Seed record only; no email was sent." },
  }, { upsert: true });
  console.log("Development seed data is ready. All records are fictional and no email was sent.");
}

seed().catch((error) => {
  console.error("Development seed failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
