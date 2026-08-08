import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers["authorization"] as string | undefined;

    if (!auth || !auth.startsWith("Bearer ")) {
      throw new UnauthorizedException("缺少 Authorization 头");
    }

    const token = auth.slice("Bearer ".length).trim();
    const claim = await this.apiKeyService.validateKey(token);
    if (!claim) {
      throw new UnauthorizedException("无效的 API Key");
    }

    request.apiKey = claim;
    await this.apiKeyService.recordCall(claim.id);
    return true;
  }
}
