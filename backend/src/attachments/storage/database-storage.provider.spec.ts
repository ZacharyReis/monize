import { NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { tenantTx } from "../../common/db/tenant-tx";
import { AttachmentBlob } from "../entities/attachment-blob.entity";
import { DatabaseStorageProvider } from "./database-storage.provider";

jest.mock("../../common/db/tenant-tx");
const mockedTenantTx = tenantTx as jest.MockedFunction<typeof tenantTx>;

describe("DatabaseStorageProvider", () => {
  let provider: DatabaseStorageProvider;
  let repo: {
    insert: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qb: {
    addSelect: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };

  beforeEach(() => {
    qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
    };
    const manager = {
      getRepository: jest.fn(() => repo),
    } as unknown as EntityManager;
    mockedTenantTx.mockImplementation((_ds, fn) => fn(manager));
    provider = new DatabaseStorageProvider({} as DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it("has the database name", () => {
    expect(provider.name).toBe("database");
  });

  it("saves bytes keyed by attachment id", async () => {
    const data = Buffer.from("x");
    await provider.save("a1", data);
    expect(repo.insert).toHaveBeenCalledWith({ attachmentId: "a1", data });
  });

  it("loads bytes for a key", async () => {
    const data = Buffer.from("x");
    qb.getOne.mockResolvedValue({ attachmentId: "a1", data } as AttachmentBlob);
    await expect(provider.load("a1")).resolves.toBe(data);
    expect(qb.addSelect).toHaveBeenCalledWith("b.data");
  });

  it("throws when the blob is missing", async () => {
    qb.getOne.mockResolvedValue(null);
    await expect(provider.load("a1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deletes bytes for a key", async () => {
    await provider.delete("a1");
    expect(repo.delete).toHaveBeenCalledWith({ attachmentId: "a1" });
  });
});
