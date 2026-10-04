from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "mysql+pymysql://recipe_user:recipe_pass@localhost:3306/recipe_manager"
    cors_origins: str = "http://localhost:4200"
    secret_key: str = "dev-only-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 30
    redis_url: str = "redis://localhost:6380/0"
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
