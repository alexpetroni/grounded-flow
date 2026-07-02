import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

// Env validation must run at Nest bootstrap (forRoot()), never at import time:
// importing a type or util from @app/config must not require a configured
// environment (it crashed vitest in CI, where no .env exists).
@Module({})
export class AppConfigModule {
  static forRoot(): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        NestConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const result = envSchema.safeParse(raw);
            if (!result.success) {
              const issues = result.error.issues
                .map((i) => `  ${i.path.join('.')}: ${i.message}`)
                .join('\n');
              throw new Error(`Invalid environment configuration:\n${issues}`);
            }
            return result.data;
          },
        }),
      ],
      exports: [NestConfigModule],
    };
  }
}
