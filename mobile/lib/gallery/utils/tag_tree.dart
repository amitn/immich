import 'package:immich_mobile/gallery/utils/journals.dart';
import 'package:openapi/api.dart';

/// A level of the tags, like the web's tag tree (`TreeNode.fromTags`): built from the paths of the tags (their
/// `value`, e.g. "Holidays/Rome"), so a level no tag stands for (e.g. "Holidays", when only "Holidays/Rome" is a tag)
/// is a node too, without photos of its own
class TagNode {
  /// The last part of the path, e.g. Rome
  final String name;

  /// The full path, e.g. Holidays/Rome; empty for the root
  final String path;

  /// The tag at this path, if there is one: its photos can be shown
  String? tagId;
  final List<TagNode> children = [];

  TagNode(this.name, this.path, {this.tagId});

  bool get hasPhotos => tagId != null;

  TagNode? child(String name) => children.where((child) => child.name == name).firstOrNull;

  /// The node at [path] below this one, or null
  TagNode? find(String path) {
    if (path.isEmpty) {
      return this;
    }
    var node = this;
    for (final part in path.split('/')) {
      final next = node.child(part);
      if (next == null) {
        return null;
      }
      node = next;
    }
    return node;
  }

  /// How many tags there are below this node
  int get tagCount => children.fold(0, (count, child) => count + (child.hasPhotos ? 1 : 0) + child.tagCount);
}

/// The tree of the tags, each level in alphabetical order
TagNode buildTagTree(List<TagResponseDto> tags) {
  final root = TagNode('', '');
  for (final tag in tags) {
    var node = root;
    final parts = tag.value.split('/').where((part) => part.isNotEmpty).toList();
    for (final (index, part) in parts.indexed) {
      var next = node.child(part);
      if (next == null) {
        next = TagNode(part, parts.take(index + 1).join('/'));
        node.children.add(next);
      }
      node = next;
    }
    if (node != root) {
      node.tagId = tag.id;
    }
  }
  _sort(root);
  return root;
}

void _sort(TagNode node) {
  node.children.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  node.children.forEach(_sort);
}

/// The tags of the Explore row, like the web's `getExploreTags`: not the photo tags of the journals (one per dish or
/// artwork: their places stand for them), by path
List<TagResponseDto> exploreTags(List<TagResponseDto> tags) =>
    tags.where((tag) => !isJournalPhotoTag(tag.value)).toList()
      ..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()));

/// The levels above a tag, e.g. "Holidays / Italy" for Holidays/Italy/Rome; empty for a tag at the top
String tagParentLabel(String value) {
  final parts = value.split('/');
  return parts.length <= 1 ? '' : parts.take(parts.length - 1).join(' / ');
}
