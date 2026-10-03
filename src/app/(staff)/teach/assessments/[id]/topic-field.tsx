"use client";

import { useState } from "react";
import { Field, Input, cn } from "@/components/ui";

// Rough topic suggestions per subject keyword. Staff pick one or type their own.
const SUBJECT_TOPICS: Record<string, string[]> = {
  mathematics: ["Numbers and numeration", "Basic operations", "Fractions and decimals", "Algebra", "Geometry", "Mensuration", "Statistics", "Percentages", "Word problems"],
  math: ["Numbers and numeration", "Basic operations", "Fractions and decimals", "Algebra", "Geometry", "Mensuration", "Statistics"],
  further: ["Algebra", "Calculus", "Trigonometry", "Statistics", "Coordinate geometry", "Matrices", "Vectors"],
  english: ["Comprehension", "Grammar and usage", "Vocabulary", "Essay writing", "Summary writing", "Literature", "Speech work"],
  literature: ["Novel", "Poetry", "Drama", "Prose", "Literary devices", "African literature"],
  science: ["Living things", "Plants and animals", "Human body", "Matter", "Forces and energy", "Earth and space", "Ecology"],
  biology: ["Cell biology", "Genetics", "Ecology", "Plant physiology", "Human body systems", "Reproduction", "Evolution"],
  chemistry: ["Atomic structure", "Chemical bonding", "Acids and bases", "Organic chemistry", "Electrochemistry", "Thermochemistry", "Periodic table"],
  physics: ["Mechanics", "Waves and sound", "Light and optics", "Electricity", "Magnetism", "Heat", "Modern physics"],
  history: ["Pre-colonial Africa", "Colonial period", "Independence movements", "World wars", "Nigerian history", "Ancient civilisations"],
  geography: ["Map reading", "Climate and vegetation", "Population", "Agriculture", "Industry", "Natural resources", "Landforms"],
  economics: ["Demand and supply", "Market structures", "National income", "International trade", "Production", "Taxation", "Money and banking"],
  commerce: ["Business organisations", "Trade", "Transport", "Insurance", "Banking", "Warehousing", "Advertising"],
  accounting: ["Balance sheet", "Profit and loss", "Cash book", "Bank reconciliation", "Ledger", "Trial balance", "Partnership accounts"],
  french: ["Greetings and introductions", "Verbs and tenses", "Reading comprehension", "Vocabulary", "Grammar"],
  yoruba: ["Ìtàn àti àṣà", "Gírámà", "Ewì", "Ìjìnlẹ̀ àṣà Yorùbá"],
  religious: ["Prayer and worship", "Prophets and messengers", "Moral values", "Religious history", "Festivals and rituals"],
  social: ["Government and citizenship", "Community living", "Social problems", "Culture and tradition", "Human rights"],
  civic: ["Democracy", "Rights and responsibilities", "Government structures", "Rule of law", "Civic virtues"],
  computer: ["Introduction to computing", "Hardware and software", "Internet and networking", "Word processing", "Spreadsheets", "Programming basics"],
  agricultural: ["Crop production", "Animal husbandry", "Soil science", "Farm tools", "Pests and diseases"],
  home: ["Food and nutrition", "Family living", "Clothing and textiles", "Child development", "Home management"],
  physical: ["Athletics", "Team sports", "First aid", "Health and fitness", "Swimming and gymnastics"],
};

function suggestTopics(subjectName: string): string[] {
  const lower = subjectName.toLowerCase();
  for (const [key, topics] of Object.entries(SUBJECT_TOPICS)) {
    if (lower.includes(key)) return topics;
  }
  return [];
}

export function TopicField({ defaultValue, subjectName, editable }: { defaultValue: string; subjectName: string; editable: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const suggestions = suggestTopics(subjectName);

  if (!editable) {
    return (
      <Field label="Topic" hint="Shown in reports and review.">
        <Input name="topic" defaultValue={defaultValue} disabled />
      </Field>
    );
  }

  return (
    <Field
      label="Topic"
      hint={!value.trim() ? "Required before you can submit for approval." : "The unit or area this test covers."}
    >
      <Input
        id="topic-input"
        name="topic"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Fractions and decimals"
        className={!value.trim() ? "border-warning" : ""}
      />
      {suggestions.length > 0 && !value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-xs text-muted self-center">Suggestions:</span>
          {suggestions.slice(0, 5).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValue(s)}
              className={cn("rounded-full border px-2.5 py-1 text-xs hover:border-brand hover:text-brand", "border-border")}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </Field>
  );
}
