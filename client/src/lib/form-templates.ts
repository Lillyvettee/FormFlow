/**
 * Ready-made forms offered when someone clicks "New form".
 *
 * Picking one opens the form builder pre-filled with it. Nothing is saved
 * until they click "Create form", and every part can be edited first.
 *
 * To add a template, add an entry to FORM_TEMPLATES. Field ids are created
 * when the template is used, so they're left out here. Field types are the
 * ones in the builder (FIELD_TYPES in pages/forms.tsx); photo and voice
 * fields can't be required.
 */

import type { FormField } from "@/types/database";

export type TemplateField = Omit<FormField, "id">;

export interface FormTemplate {
  id: string;
  /** Shown on the template card. */
  name: string;
  category: "Volunteers" | "Events" | "Fundraising" | "Programs" | "General";
  summary: string;
  /** Filled into the builder. */
  title: string;
  description: string;
  fields: TemplateField[];
}

const text = (label: string, required = false, placeholder = ""): TemplateField => ({ label, type: "text", required, placeholder, options: [] });
const longText = (label: string, required = false, placeholder = ""): TemplateField => ({ label, type: "textarea", required, placeholder, options: [] });
const email = (required = true): TemplateField => ({ label: "Email", type: "email", required, placeholder: "you@example.com", options: [] });
const phone = (required = false): TemplateField => text("Phone number", required, "(555) 555-5555");
const fullName = (label = "Full name"): TemplateField => text(label, true);
const number = (label: string, required = false, placeholder = ""): TemplateField => ({ label, type: "number", required, placeholder, options: [] });
const date = (label: string, required = false): TemplateField => ({ label, type: "date", required, placeholder: "", options: [] });
const dropdown = (label: string, options: string[], required = false): TemplateField => ({ label, type: "select", required, placeholder: "", options });
const checkbox = (label: string, required = false): TemplateField => ({ label, type: "checkbox", required, placeholder: "", options: [] });
const photo = (label: string): TemplateField => ({ label, type: "image", required: false, placeholder: "", options: [] });

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: "volunteer-signup",
    name: "Volunteer sign-up",
    category: "Volunteers",
    summary: "Collect new volunteers' contact details, availability and interests.",
    title: "Volunteer Sign-Up",
    description: "Thanks for your interest in volunteering with us! Tell us a bit about yourself and we'll be in touch.",
    fields: [
      fullName(),
      email(),
      phone(),
      dropdown("When are you available?", ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends", "Flexible"], true),
      dropdown("What would you like to help with?", ["Events", "Office and admin", "Outreach", "Mentoring or tutoring", "Wherever I'm needed"]),
      longText("Any skills or experience you'd like to share?"),
      checkbox("I'm 18 or older"),
    ],
  },
  {
    id: "event-registration",
    name: "Event registration",
    category: "Events",
    summary: "RSVPs with party size and dietary or access needs.",
    title: "Event Registration",
    description: "Save your spot! Fill this out to register for the event.",
    fields: [
      fullName(),
      email(),
      number("How many people, including you?", true, "1"),
      dropdown("Dietary needs", ["None", "Vegetarian", "Vegan", "Gluten-free", "Other (tell us below)"]),
      longText("Accessibility needs or anything else we should know?"),
      checkbox("Email me about future events"),
    ],
  },
  {
    id: "donation-pledge",
    name: "Donation pledge",
    category: "Fundraising",
    summary: "Record pledges and how donors plan to give.",
    title: "Donation Pledge",
    description: "Thank you for supporting our mission. Fill this out and we'll follow up with how to complete your gift.",
    fields: [
      fullName(),
      email(),
      phone(),
      number("Pledge amount ($)", true, "100"),
      dropdown("How often?", ["One time", "Monthly", "Quarterly", "Yearly"], true),
      dropdown("How would you like to give?", ["Check", "Credit card", "Bank transfer", "Cash", "Not sure yet"]),
      text("Give in honor or memory of (optional)"),
      checkbox("Please keep my gift anonymous"),
    ],
  },
  {
    id: "in-kind-donation",
    name: "In-kind donation",
    category: "Fundraising",
    summary: "Log donated goods, their condition and drop-off plans.",
    title: "In-Kind Donation",
    description: "Donating goods? Tell us what you have so we can plan for it.",
    fields: [
      fullName("Your name or business"),
      email(),
      phone(),
      longText("What are you donating?", true, "e.g. 3 boxes of canned food, 10 winter coats"),
      dropdown("Condition", ["New", "Like new", "Good", "Fair"], true),
      number("Estimated value ($)"),
      dropdown("Drop-off or pick-up?", ["I'll drop it off", "Please pick it up"], true),
      photo("Photo of the items (optional)"),
    ],
  },
  {
    id: "client-intake",
    name: "Client intake",
    category: "Programs",
    summary: "Basic household details and needs for people you serve.",
    title: "Client Intake",
    description: "Welcome. This helps us understand how we can best support you. Your information is kept private.",
    fields: [
      fullName(),
      date("Date of birth"),
      phone(),
      email(false),
      text("ZIP code", true),
      number("People in your household", true),
      dropdown("What do you need help with most?", ["Food", "Housing", "Clothing", "Transportation", "Job support", "Other"], true),
      longText("Anything else you'd like us to know?"),
      checkbox("I agree that this information can be used to provide services", true),
    ],
  },
  {
    id: "program-application",
    name: "Program application",
    category: "Programs",
    summary: "Applications for a program, class or scholarship.",
    title: "Program Application",
    description: "Apply to join our program. We review applications every two weeks.",
    fields: [
      fullName(),
      email(),
      phone(),
      date("Date of birth", true),
      dropdown("How did you hear about us?", ["Friend or family", "School", "Social media", "Community event", "Other"]),
      longText("Why are you interested in this program?", true),
      longText("What do you hope to get out of it?"),
      checkbox("The information I've given is true and complete", true),
    ],
  },
  {
    id: "feedback-survey",
    name: "Feedback survey",
    category: "General",
    summary: "Ratings and comments after a program, event or visit.",
    title: "Feedback Survey",
    description: "We'd love to hear how we did. This takes about two minutes.",
    fields: [
      dropdown("Overall, how satisfied were you?", ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very dissatisfied"], true),
      dropdown("How likely are you to recommend us?", ["Very likely", "Likely", "Not sure", "Unlikely"]),
      longText("What did we do well?"),
      longText("What could we do better?"),
      text("Your name (optional)"),
      checkbox("You can contact me about my feedback"),
      email(false),
    ],
  },
  {
    id: "contact-us",
    name: "Contact us",
    category: "General",
    summary: "A simple message form for your website.",
    title: "Contact Us",
    description: "Have a question? Send us a message and we'll get back to you.",
    fields: [
      fullName("Name"),
      email(),
      dropdown("What's this about?", ["General question", "Volunteering", "Donating", "Getting help", "Partnership", "Other"]),
      longText("Message", true),
    ],
  },
  {
    id: "membership",
    name: "Membership application",
    category: "General",
    summary: "Join as a member, with level and contact preferences.",
    title: "Membership Application",
    description: "Become a member and help support our work all year long.",
    fields: [
      fullName(),
      email(),
      phone(),
      text("Mailing address"),
      dropdown("Membership level", ["Individual", "Family", "Student", "Senior", "Business"], true),
      dropdown("How would you like to hear from us?", ["Email", "Text message", "Mail", "No updates please"]),
      checkbox("I agree to the membership terms", true),
    ],
  },
  {
    id: "newsletter",
    name: "Newsletter sign-up",
    category: "General",
    summary: "Grow your mailing list in a few seconds per person.",
    title: "Join Our Newsletter",
    description: "Get updates on our work, events and ways to help.",
    fields: [
      text("First name", true),
      email(),
      dropdown("What interests you?", ["Everything", "Events", "Volunteering", "Impact stories"]),
    ],
  },
  {
    id: "volunteer-hours",
    name: "Volunteer hours log",
    category: "Volunteers",
    summary: "Volunteers report their own shifts and hours.",
    title: "Log Your Volunteer Hours",
    description: "Thanks for your time! Record your shift here.",
    fields: [
      fullName(),
      email(),
      date("Date of shift", true),
      number("Hours", true, "2"),
      dropdown("Activity", ["Events", "Office and admin", "Outreach", "Distribution", "Other"], true),
      longText("Notes"),
    ],
  },
  {
    id: "photo-release",
    name: "Photo release",
    category: "Events",
    summary: "Permission to use someone's photo in your materials.",
    title: "Photo and Media Release",
    description:
      "We'd like to share photos and videos from our activities. Please let us know if we may include you.",
    fields: [
      fullName(),
      email(false),
      dropdown("May we use photos or video that include you?", ["Yes", "Yes, but don't use my name", "No"], true),
      text("Parent or guardian name (if under 18)"),
      date("Today's date", true),
      checkbox("I have read and agree to this release", true),
    ],
  },
];
