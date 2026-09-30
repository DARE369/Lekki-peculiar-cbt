import type { Metadata } from "next";
import { ExamTerminal } from "@/components/exam/terminal";

export const metadata: Metadata = { title: "Exam", robots: { index: false } };

export default function ExamPage() {
  return <ExamTerminal />;
}
