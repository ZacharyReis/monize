import { Entity, ManyToOne, JoinColumn, PrimaryColumn } from "typeorm";
import { Security } from "./security.entity";
import { Tag } from "../../tags/entities/tag.entity";

@Entity("security_tags")
export class SecurityTag {
  @PrimaryColumn({ type: "uuid", name: "security_id" })
  securityId: string;

  @PrimaryColumn({ type: "uuid", name: "tag_id" })
  tagId: string;

  @ManyToOne(() => Security, { onDelete: "CASCADE" })
  @JoinColumn({ name: "security_id" })
  security: Security;

  @ManyToOne(() => Tag, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tag_id" })
  tag: Tag;
}
