/* eslint-disable react-hooks/refs */
import { memo, useRef, useEffect } from "react";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "@/utils/chat/purify";
import Citations from "../Citation";
import CompactError from "@/components/lib/MinimalUI/CompactError";
import {
  THOUGHT_REGEX_CLOSE,
  THOUGHT_REGEX_COMPLETE,
  THOUGHT_REGEX_OPEN,
  ThoughtChainComponent,
} from "../ThoughtContainer";
import WorkspaceSummaryKpis from "../WorkspaceSummaryKpis";

const PromptReply = ({
  uuid,
  reply,
  pending,
  error,
  sources = [],
  onRetry,
  workspaceSummaryMetadata = null,
}) => {
  if (!reply && sources.length === 0 && !pending && !error) return null;

  if (pending) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-3 pl-0 pr-4 flex flex-col w-full">
          <div className="mt-2 ml-1 dot-falling light:invert"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-3 pl-0 pr-4 flex flex-col w-full">
          <CompactError message={error} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  return (
    <div key={uuid} className="flex justify-start w-full">
      <div className="py-3 pl-0 pr-4 flex flex-col w-full">
        <WorkspaceSummaryKpis metadata={workspaceSummaryMetadata} />
        <RenderAssistantChatContent
          key={`${uuid}-prompt-reply-content`}
          message={reply}
          messageId={uuid}
        />
        <Citations sources={sources} />
      </div>
    </div>
  );
};

function RenderAssistantChatContent({ message, messageId }) {
  const contentRef = useRef("");
  const thoughtChainRef = useRef(null);

  useEffect(() => {
    const thinking =
      message.match(THOUGHT_REGEX_OPEN) && !message.match(THOUGHT_REGEX_CLOSE);

    if (thinking && thoughtChainRef.current) {
      thoughtChainRef.current.updateContent(message);
      return;
    }

    const completeThoughtChain = message.match(THOUGHT_REGEX_COMPLETE)?.[0];
    const msgToRender = message.replace(THOUGHT_REGEX_COMPLETE, "");

    if (completeThoughtChain && thoughtChainRef.current) {
      thoughtChainRef.current.updateContent(completeThoughtChain);
    }

    contentRef.current = msgToRender;
  }, [message]);

  const thinking =
    message.match(THOUGHT_REGEX_OPEN) && !message.match(THOUGHT_REGEX_CLOSE);
  if (thinking)
    return (
      <ThoughtChainComponent
        ref={thoughtChainRef}
        content=""
        messageId={messageId}
      />
    );

  return (
    <div className="flex flex-col gap-y-1">
      {message.match(THOUGHT_REGEX_COMPLETE) && (
        <ThoughtChainComponent
          ref={thoughtChainRef}
          content=""
          messageId={messageId}
        />
      )}
      <span
        className="break-words"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(renderMarkdown(contentRef.current)),
        }}
      />
    </div>
  );
}

export default memo(PromptReply);
