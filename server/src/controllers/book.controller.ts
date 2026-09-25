import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiTag } from 'src/enum.js';
import { BookService } from 'src/services/book.service.js';

@ApiTags(ApiTag.Books)
@Controller('books')
export class BookController {
  constructor(private service: BookService) {}
}
