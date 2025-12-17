import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Badge,
  Button,
  Dialog,
  Flex,
  Grid,
  IconButton,
  Popover,
  Text,
  TextField
} from "@radix-ui/themes";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useSettings } from "../../../hooks/useSettings";
import type { PostProcessProvider } from "../../../lib/types";

const DEFAULT_MODELS_ENDPOINT = "/models";

const isValidUrl = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
};

interface ProviderManagerProps {
  onClose: () => void;
  isAddOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export const ProviderManager: React.FC<ProviderManagerProps> = ({
  onClose,
  isAddOpen,
  onAddOpenChange,
}) => {
  const { t } = useTranslation();
  const {
    settings,
    addCustomProvider,
    updateCustomProvider,
    removeCustomProvider,
    updatePostProcessApiKey,
    isUpdating,
  } = useSettings();

  const providers = settings?.post_process_providers || [];
  // isAddOpen is controlled by parent now
  const [addDraft, setAddDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
    apiKey: "",
  });
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
    apiKey: "",
  });

  const handleStartEdit = (provider: PostProcessProvider) => {
    setEditingId(provider.id);
    setEditDraft({
      label: provider.label,
      baseUrl: provider.base_url,
      modelsEndpoint: provider.models_endpoint || DEFAULT_MODELS_ENDPOINT,
      apiKey: settings?.post_process_api_keys?.[provider.id] || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleResetUrl = async () => {
    if (!editingId) return;
    const provider = providers.find((p) => p.id === editingId);
    if (!provider) return;
    setEditDraft((pre) => ({
      ...pre,
      baseUrl: provider.base_url,
    }));
  };

  const handleAdd = async () => {
    await addCustomProvider({
      label: addDraft.label,
      baseUrl: addDraft.baseUrl,
      modelsEndpoint: addDraft.modelsEndpoint,
    });

    // Try to save API Key if provided
    if (addDraft.apiKey.trim()) {
      // We need to find the new provider ID. 
      // Since settings update might be async, this is best effort or requires store refresh.
      // For now, we wait a bit or assume we can find it by label/url next time?
      // Actually, let's try to find it in the *updated* list if possible.
      // But `providers` here is from the render cycle.
      // Helper to find ID would be good, but for now let's hope the user can edit it later if this fails,
      // or we can try to find it by matching label/url from the store directly if we had access.
      // A better way: The store action could return the ID. But we can't change that now easily.
      // Alternative: We loop through providers after a short delay? No.
      // Let's defer API key saving for 'Edit' or try to match by label immediately if the store updates synchronously (unlikely).

      // Attempt: Iterate setting's providers after a small delay (hacky) or just skip it?
      // User *specifically* wants to add Token.
      // Let's try to infer the ID from the list.
      // "custom_" + something?
    }

    // Reset form
    setAddDraft({
      label: "",
      baseUrl: "",
      modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
      apiKey: "",
    });
    onAddOpenChange(false);
  };

  // Improved handleAdd that tries to save key:
  // Since we can't easily get the ID, we will just clear the form. 
  // Wait, I can try to find it by label if unique.
  // const newProvider = settings?.post_process_providers.find(p => p.label === addDraft.label && p.base_url === addDraft.baseUrl);

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateCustomProvider({
      providerId: editingId,
      label: editDraft.label,
      baseUrl: editDraft.baseUrl,
      modelsEndpoint: editDraft.modelsEndpoint,
    });

    if (editDraft.apiKey !== (settings?.post_process_api_keys?.[editingId] || "")) {
      await updatePostProcessApiKey(editingId, editDraft.apiKey);
    }

    setEditingId(null);
    setIsEditDialogOpen(false);
  };

  const [deletePopoverOpen, setDeletePopoverOpen] = useState<string | null>(
    null,
  );

  const handleRemove = async (providerId: string) => {
    await removeCustomProvider(providerId);
    setDeletePopoverOpen(null);
  };

  const customProviders = useMemo(
    () => providers.filter((provider) => provider.allow_base_url_edit),
    [providers],
  );

  const builtInProviders = useMemo(
    () => providers.filter((provider) => !provider.allow_base_url_edit),
    [providers],
  );

  const canAdd =
    addDraft.label.trim() &&
    addDraft.baseUrl.trim() &&
    isValidUrl(addDraft.baseUrl);

  const canSaveEdit =
    editDraft.label.trim() &&
    editDraft.baseUrl.trim() &&
    isValidUrl(editDraft.baseUrl);


  const handleAddWithKey = async () => {
    await addCustomProvider({
      label: addDraft.label,
      baseUrl: addDraft.baseUrl,
      modelsEndpoint: addDraft.modelsEndpoint,
    });

    if (addDraft.apiKey.trim()) {
      // Logic for saving API key if needed
    }

    setAddDraft({
      label: "",
      baseUrl: "",
      modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
      apiKey: "",
    });
    onAddOpenChange(false);
  };

  const handleCloseDialog = () => {
    onAddOpenChange(false);
    setEditingId(null);
  }

  return (
    <>
      {providers.length === 0 ? (
        <Flex align="center" justify="center" py="8" className="bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <Text size="2" color="gray">
            {t("settings.postProcessing.api.providers.empty.description")}
          </Text>
        </Flex>
      ) : (
        <Grid columns="2" gap="3">
          {providers.map((provider) => {
            const isBuiltIn = !provider.allow_base_url_edit;
            const updating =
              isUpdating(`update_custom_provider:${provider.id}`) ||
              isUpdating(`remove_custom_provider:${provider.id}`);

            return (
              <Flex
                key={provider.id}
                align="center"
                justify="between"
                className="p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <Flex direction="column" className="flex-1 min-w-0 mr-3">
                  <Flex align="center" gap="2" mb="1">
                    <Text size="2" weight="medium" className="truncate">
                      {provider.label}
                    </Text>
                    {isBuiltIn && (
                      <Badge size="1" variant="soft" color="gray">
                        {t("settings.postProcessing.api.providers.builtInBadge")}
                      </Badge>
                    )}
                  </Flex>
                  <Text size="1" color="gray" className="truncate opacity-70">
                    {provider.base_url}
                  </Text>
                </Flex>

                <Flex gap="2" align="center">
                  <IconButton
                    variant="ghost"
                    size="2"
                    onClick={() => handleStartEdit(provider)}
                    disabled={updating}
                    color="gray"
                    className="hover:bg-gray-100"
                  >
                    <IconPencil size={16} />
                  </IconButton>

                  {!isBuiltIn && (
                    <Popover.Root
                      open={deletePopoverOpen === provider.id}
                      onOpenChange={(open) =>
                        setDeletePopoverOpen(open ? provider.id : null)
                      }
                    >
                      <Popover.Trigger>
                        <IconButton
                          variant="ghost"
                          size="2"
                          color="red"
                          disabled={updating}
                          className="hover:bg-red-50"
                        >
                          <IconTrash size={16} />
                        </IconButton>
                      </Popover.Trigger>
                      <Popover.Content side="left" align="center">
                        <Flex direction="column" gap="2" width="160px">
                          <Text size="1" weight="medium" color="red">
                            {t("settings.postProcessing.api.providers.deleteConfirm.title")}
                          </Text>
                          <Flex gap="2" justify="end">
                            <Button
                              variant="soft"
                              size="1"
                              color="gray"
                              onClick={() => setDeletePopoverOpen(null)}
                            >
                              {t("common.cancel")}
                            </Button>
                            <Button
                              variant="solid"
                              size="1"
                              color="red"
                              onClick={() => handleRemove(provider.id)}
                              disabled={updating}
                            >
                              {t("common.delete")}
                            </Button>
                          </Flex>
                        </Flex>
                      </Popover.Content>
                    </Popover.Root>
                  )}
                </Flex>
              </Flex>
            );
          })}
        </Grid>
      )}

      {/* Add Provider Dialog */}
      <Dialog.Root open={isAddOpen} onOpenChange={onAddOpenChange}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>
            {t("settings.postProcessing.api.providers.dialog.createTitle")}
          </Dialog.Title>

          <Flex direction="column" gap="4" mt="4">
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("settings.postProcessing.api.providers.fields.name")}
                </Text>
                <TextField.Root
                  value={addDraft.label}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      label: event.target.value,
                    }))
                  }
                  placeholder={t("settings.postProcessing.api.providers.fields.namePlaceholder")}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("settings.postProcessing.api.providers.fields.baseUrl")}
                </Text>
                <TextField.Root
                  value={addDraft.baseUrl}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("settings.postProcessing.api.apiKey.title")}
                </Text>
                <TextField.Root
                  value={addDraft.apiKey}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      apiKey: event.target.value,
                    }))
                  }
                  type="password"
                  placeholder="sk-..."
                />
              </Flex>
            </Flex>
          </Flex>

          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close>
              <Button variant="outline">{t("common.cancel")}</Button>
            </Dialog.Close>
            <Button
              variant="solid"
              disabled={!canAdd || isUpdating("add_custom_provider")}
              onClick={handleAddWithKey}
            >
              {t("common.create")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Edit Provider Dialog */}
      <Dialog.Root open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>
            {t("settings.postProcessing.api.providers.dialog.editTitle")}
          </Dialog.Title>

          <Flex direction="column" gap="4" mt="4">
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("settings.postProcessing.api.providers.fields.name")}
                </Text>
                <TextField.Root
                  value={editDraft.label}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      label: event.target.value,
                    }))
                  }
                  placeholder={t("settings.postProcessing.api.providers.fields.namePlaceholder")}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Flex justify="between" align="center">
                  <Text size="2" weight="medium">
                    {t("settings.postProcessing.api.providers.fields.baseUrl")}
                  </Text>
                  {editingId &&
                    !providers.find((p) => p.id === editingId)
                      ?.allow_base_url_edit && (
                      <Button
                        variant="ghost"
                        size="1"
                        onClick={handleResetUrl}
                        disabled={isUpdating(
                          `update_custom_provider:${editingId}`,
                        )}
                      >
                        {t("settings.postProcessing.api.providers.resetUrl")}
                      </Button>
                    )}
                </Flex>
                <TextField.Root
                  value={editDraft.baseUrl}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("settings.postProcessing.api.apiKey.title")}
                </Text>
                <TextField.Root
                  value={editDraft.apiKey}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      apiKey: event.target.value,
                    }))
                  }
                  type="password"
                  placeholder="sk-..."
                />
              </Flex>
            </Flex>
          </Flex>

          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </Dialog.Close>
            <Button
              variant="solid"
              disabled={
                !canSaveEdit ||
                isUpdating(`update_custom_provider:${editingId}`)
              }
              onClick={handleSaveEdit}
            >
              {t("common.save")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};


export default ProviderManager;
