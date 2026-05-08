import { createFileRoute } from "@tanstack/react-router";
import ChatStoryGenerator from "@/components/ChatStoryGenerator";

export const Route = createFileRoute("/")({
  component: ChatStoryGenerator,
});
