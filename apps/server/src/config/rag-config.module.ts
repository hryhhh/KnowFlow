import { Global, Module } from "@nestjs/common";
import { RAG_CONFIG, createRagConfig } from "./rag-config.provider";

@Global()
@Module({
  providers: [
    {
      provide: RAG_CONFIG,
      useFactory: () => createRagConfig(),
    },
  ],
  exports: [RAG_CONFIG],
})
export class RagConfigModule {}
